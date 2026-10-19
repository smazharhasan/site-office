-- =====================================================================
-- Site Office Platform — core schema (multi-builder, multi-client, multi-project)
-- PostgreSQL 15+ / Supabase. All business tables are scoped by project_id
-- and protected by row-level security (see 20261019000200_security.sql).
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- tenancy -------------------------------------------------------
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null check (kind in ('builder','client','consultant','supplier','platform')),
  ntn           text, strn text, secp_no text, pec_no text,
  phone         text, email text, address text, city text,
  created_by    uuid default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now()
);

create table profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  phone         text,
  locale        text not null default 'en' check (locale in ('en','ur')),
  created_at    timestamptz not null default now()
);

create table projects (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id),     -- organization that runs the project
  name            text not null,
  address         text,
  description     text,                                            -- given to the AI as context
  covered_area_sft numeric,
  start_date      date,
  contract_months int not null default 18 check (contract_months between 1 and 120),
  site_lat        double precision,
  site_lng        double precision,
  site_radius_m   int not null default 300 check (site_radius_m between 30 and 5000),
  max_photo_age_min int not null default 15,                       -- evidence must reach the server within this
  max_gps_accuracy_m int not null default 60,
  timezone        text not null default 'Asia/Karachi',
  created_at      timestamptz not null default now()
);

-- parties to the project: client, builder, architect, structural, MEP, sub-contractors
create table parties (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  org_id      uuid references organizations(id),
  type        text not null check (type in ('client','builder','architect','structural','mep','subcontractor','testing_lab','authority','other')),
  name        text not null,
  ntn text, strn text, secp_no text, pec_no text, cnic text,
  contact text, phone text, email text, address text, city text, bank text, iban text,
  status      text not null default 'active' check (status in ('active','pending','blacklisted')),
  created_at  timestamptz not null default now()
);

create table project_members (
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','owner_supervisor','builder','site_supervisor','store_keeper','supplier','consultant')),
  supplier_id uuid,                                  -- set for role = supplier
  person_id   uuid,                                  -- the member's own registered person record
  active      boolean not null default true,
  added_by    uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------- people register (everyone on site, with or without an app login) ----
create table people (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid references auth.users(id),
  full_name       text not null,
  father_name     text,
  cnic            text not null check (cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'),
  cnic_expiry     date,
  phone           text,
  address         text,
  emergency_contact text,
  type            text not null check (type in ('labour','mistri','store_keeper','supervisor','engineer','guard','cook','driver','supplier_staff','builder_staff','consultant','owner_team','owner')),
  trade           text,
  gang            text,
  btk_card_no     text,
  btk_card_expiry date,
  police_verification text not null default 'pending' check (police_verification in ('pending','done','not_required')),
  daily_wage      numeric(12,2),
  status          text not null default 'pending' check (status in ('pending','active','inactive','blocked')),
  verified_by     uuid references auth.users(id),
  verified_at     timestamptz,
  badge_token     uuid not null default gen_random_uuid(),        -- printed in the QR badge; rotate when a badge is lost
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (project_id, cnic),
  unique (badge_token)
);
alter table project_members add constraint project_members_person_fk foreign key (person_id) references people(id);

create table person_docs (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  kind        text not null check (kind in ('photo','cnic_front','cnic_back','btk_card','police_letter')),
  evidence_id uuid not null,                         -- captured through the evidence pipeline
  created_at  timestamptz not null default now(),
  unique (person_id, kind)
);

-- ---------- devices (each phone is bound to a user and approved by the owner) ----
create table devices (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  device_key    text not null,                       -- Android ID (per app signing key) from expo-application
  model         text, os text, app_version text,
  approved      boolean not null default false,
  approved_by   uuid references auth.users(id),
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (project_id, device_key)
);

-- ---------- evidence: every photo, written ONLY by the ingest-evidence function ----
create table evidence (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  storage_path    text not null unique,
  sha256          text not null,
  purpose         text not null check (purpose in ('attendance','badge','release','receipt_truck','receipt_bill','receipt_marking','tanker','tanker_bill','count','daily_log','inspection','snag','person_doc','progress','other')),
  user_id         uuid not null references auth.users(id),
  device_id       uuid references devices(id),
  captured_at     timestamptz not null,              -- phone clock at capture
  received_at     timestamptz not null default now(),-- server clock: the time that counts
  lat             double precision,
  lng             double precision,
  accuracy_m      double precision,
  mocked          boolean,                           -- Android reports mock-location providers
  distance_m      double precision,                  -- from the project site, computed on insert
  integrity       text not null default 'not_checked' check (integrity in ('ok','failed','not_checked')),
  flags           text[] not null default '{}',
  created_at      timestamptz not null default now()
);
alter table person_docs add constraint person_docs_evidence_fk foreign key (evidence_id) references evidence(id);

-- ---------- attendance ----------------------------------------------------
create table attendance (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  person_id       uuid not null references people(id),
  work_date       date not null,
  direction       text not null check (direction in ('in','out')),
  at              timestamptz not null default now(),
  badge_evidence_id uuid references evidence(id),
  face_evidence_id  uuid not null references evidence(id),
  badge_token_ok  boolean not null,
  marked_by       uuid not null references auth.users(id),
  status          text not null default 'pending' check (status in ('pending','verified','flagged','approved','rejected')),
  flags           text[] not null default '{}',
  face_match      jsonb,
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  unique (project_id, person_id, work_date, direction)
);

-- ---------- catalogue, suppliers, procurement -----------------------------
create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  stype       text not null default 'material' check (stype in ('material','service','consultant','testing_lab','equipment_hire','general_store')),
  categories  text[] not null default '{}',
  contact text, phone text, email text, cnic text, ntn text, strn text, secp_no text, pec_no text, bank text, iban text, city text, address text,
  status      text not null default 'pending' check (status in ('pending','approved','blacklisted','blocked')),
  rating      int check (rating between 1 and 5),
  registered_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table project_members add constraint project_members_supplier_fk foreign key (supplier_id) references suppliers(id);

create table materials (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  code            text,
  name            text not null,
  kind            text not null default 'material' check (kind in ('material','tool','canteen','consumable')),
  category        text,
  phase           text not null default 'grey' check (phase in ('design','grey','finishing','testing','site_running')),
  unit            text not null,
  budget_qty      numeric, budget_rate numeric, reorder_level numeric,
  monthly_budget  numeric,                          -- canteen / consumables
  norm_per_man_day numeric,                         -- canteen: expected use per verified worker-day
  return_days     int,                              -- tools
  spec            text,
  spec_checks     text[] not null default '{}',
  image_path      text,
  created_at      timestamptz not null default now()
);

create table stages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  phase       text not null check (phase in ('design','grey','finishing','handover')),
  seq         int not null default 0,
  weight      numeric not null default 1,
  plan_start  date, plan_end date,
  reported_pct numeric check (reported_pct between 0 and 100),
  verified_pct numeric check (verified_pct between 0 and 100)
);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  parent_id   uuid references tasks(id) on delete cascade,  -- sub-tasks
  stage_id    uuid references stages(id),
  code        text,
  title       text not null,
  plan_start  date, plan_end date,
  baseline_start date, baseline_end date,
  depends_on  uuid[] not null default '{}',
  assignee_person_id uuid references people(id),
  assignee_supplier_id uuid references suppliers(id),
  progress    numeric not null default 0 check (progress between 0 and 100),
  status      text not null default 'not_started' check (status in ('not_started','in_progress','done','on_hold','blocked'))
);

create table rfqs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  no          text not null,
  title       text not null,
  phase       text not null check (phase in ('design','grey','finishing','mep','testing','consultancy','site_running','canteen')),
  item_type   text not null check (item_type in ('material','service','consultancy','testing','equipment_hire','tools','canteen')),
  material_id uuid references materials(id),
  description text,
  qty         numeric not null check (qty > 0),
  unit        text,
  needed_by   date,
  spec        text,
  invited_supplier_ids uuid[] not null default '{}',
  status      text not null default 'open' check (status in ('draft','open','closed','awarded','cancelled')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  check (material_id is not null or description is not null),
  unique (project_id, no)
);

create table quotes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  rfq_id      uuid not null references rfqs(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  unit_price  numeric not null check (unit_price >= 0),
  delivery_days int, valid_until date, terms text,
  status      text not null default 'submitted' check (status in ('submitted','accepted','rejected','withdrawn')),
  created_at  timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  no          text not null,
  rfq_id      uuid references rfqs(id), quote_id uuid references quotes(id),
  supplier_id uuid not null references suppliers(id),
  phase       text not null, item_type text not null,
  material_id uuid references materials(id),
  description text,
  qty         numeric not null check (qty > 0), unit text,
  unit_price  numeric not null check (unit_price >= 0),
  delivery_date date,
  status      text not null default 'pending_approval' check (status in ('pending_approval','approved','issued','delivered','closed','cancelled')),
  pay_status  text not null default 'unpaid' check (pay_status in ('unpaid','advance_paid','paid')),
  approved_by uuid references auth.users(id), approved_at timestamptz,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  check (material_id is not null or description is not null),
  unique (project_id, no)
);

-- ---------- stores ---------------------------------------------------------
create table grns (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  no                text not null,
  po_id             uuid references purchase_orders(id),
  material_id       uuid not null references materials(id),
  vendor            text,                              -- purchases without a PO (canteen, petty items)
  bill_no           text,
  vehicle_no        text,
  qty_received      numeric not null check (qty_received >= 0),
  qty_accepted      numeric not null check (qty_accepted >= 0),
  qty_rejected      numeric generated always as (qty_received - qty_accepted) stored,
  rate              numeric, amount numeric,
  truck_evidence_id   uuid references evidence(id),
  bill_evidence_id    uuid not null references evidence(id),   -- a bill scan is mandatory
  marking_evidence_id uuid references evidence(id),
  received_by       uuid not null references people(id),
  ai                jsonb,
  at                timestamptz not null default now(),
  created_by        uuid not null references auth.users(id),
  check (qty_accepted <= qty_received),
  check (po_id is not null or vendor is not null),
  unique (project_id, no)
);

create table stock_moves (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  material_id     uuid not null references materials(id),
  kind            text not null check (kind in ('receipt','release','return','lost','adjustment')),
  qty             numeric not null check (qty > 0),
  person_id       uuid references people(id),          -- receiver (release) / returner (return)
  authorised_by   uuid references people(id),
  store_keeper    uuid references people(id),
  stage_id        uuid references stages(id),
  area            text,
  grn_id          uuid references grns(id),
  evidence_id     uuid references evidence(id),
  ai              jsonb,
  note            text,
  at              timestamptz not null default now(),
  created_by      uuid not null references auth.users(id)
);

create table water_tankers (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  tanker_no         text not null,
  supplier          text,
  gallons           numeric not null check (gallons > 0),
  water_type        text not null default 'sweet' check (water_type in ('sweet','drinking','brackish_rejected')),
  tds_ppm           numeric,
  cost              numeric,
  bill_no           text,
  to_tank           text,
  tanker_evidence_id uuid not null references evidence(id),
  bill_evidence_id   uuid not null references evidence(id),   -- tanker bill must be scanned at refill
  tds_evidence_id    uuid references evidence(id),
  received_by       uuid not null references people(id),
  ai                jsonb,
  at                timestamptz not null default now(),
  created_by        uuid not null references auth.users(id)
);

create table stock_counts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  material_id uuid not null references materials(id),
  counted     numeric not null check (counted >= 0),
  book_qty    numeric,                                  -- filled by trigger at insert
  evidence_id uuid not null references evidence(id),
  counted_by  uuid not null references people(id),
  ai          jsonb,
  at          timestamptz not null default now()
);

-- ---------- site records ----------------------------------------------------
create table daily_logs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  log_date      date not null,
  weather       jsonb,
  power         text check (power in ('btk_normal','btk_outage_generator','btk_outage_work_affected','generator_only')),
  outage_hours  numeric,
  staff_present uuid[] not null default '{}',          -- registered people only (checked by trigger)
  work_done     jsonb not null default '[]',           -- [{task_id, note}]
  plan_tomorrow jsonb not null default '[]',
  notes         text,
  photo_evidence_ids uuid[] not null default '{}',
  ai            jsonb,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (project_id, log_date)
);

create table inspections (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  no            text not null,
  mode          text not null check (mode in ('planned','random')),
  type          text not null,
  stage_id      uuid references stages(id),
  location      text,
  at            timestamptz not null default now(),
  inspector     uuid not null references people(id),
  responsible   text not null default 'builder',       -- 'builder' | 'supplier:<uuid>' | 'party:<uuid>'
  status        text not null default 'scheduled' check (status in ('requested','scheduled','passed','conditional_pass','failed_ncr_open','ncr_closed')),
  checks        jsonb not null default '[]',           -- [{t, res: pass|fail|conditional|na, note, due}] in user order
  findings      jsonb not null default '[]',           -- [{text, trade, severity, note}]
  photo_evidence_ids uuid[] not null default '{}',
  ai_actions    jsonb,
  signatures    jsonb not null default '{}',
  unique (project_id, no)
);

create table checklists (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  type        text not null,
  stage_id    uuid references stages(id),
  responsible uuid references people(id),
  due         date,
  items       jsonb not null default '[]',
  status      text not null default 'open' check (status in ('open','closed')),
  signatures  jsonb not null default '{}'
);

create table issues_register (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  no          text not null,
  type        text not null check (type in ('issue','delay','safety','quality','cost','risk','authority')),
  title       text not null,
  description text,
  impact      text not null default 'medium' check (impact in ('low','medium','high')),
  delay_days  int, cost_impact numeric,
  responsible text,
  status      text not null default 'open' check (status in ('open','mitigating','closed')),
  due         date,
  raised_by   uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (project_id, no)
);

create table contracts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  party_id    uuid references parties(id),
  supplier_id uuid references suppliers(id),
  type        text not null,
  title       text not null,
  value       numeric,
  signed_on   date, start_date date, end_date date,
  status      text not null default 'signed' check (status in ('draft','negotiation','signed','active','completed','terminated')),
  file_path   text,
  text_content text,
  ai          jsonb,
  created_at  timestamptz not null default now()
);

create table audit_log (
  id          bigserial primary key,
  project_id  uuid,
  table_name  text not null,
  row_id      uuid,
  action      text not null,
  actor       uuid,
  at          timestamptz not null default now(),
  old_row     jsonb,
  new_row     jsonb
);

create index on stock_moves (project_id, material_id, at);
create index on attendance (project_id, work_date);
create index on evidence (project_id, received_at);
create index on grns (project_id, at);
create index on audit_log (project_id, at);
