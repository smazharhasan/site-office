-- =====================================================================
-- Rules that make the records hard to fake: helper functions, integrity
-- triggers, attendance RPC, views and row-level security.
-- =====================================================================

alter table projects add column if not exists created_by uuid default auth.uid() references auth.users(id);

-- ---------- helpers --------------------------------------------------------
create or replace function app_role(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from project_members where project_id = p and user_id = auth.uid() and active
$$;
create or replace function is_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = p and user_id = auth.uid() and active)
$$;
create or replace function has_role(p uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_role(p) = any (roles), false)
$$;
create or replace function is_staff(p uuid) returns boolean
language sql stable as $$ select has_role(p, array['owner','owner_supervisor','builder','site_supervisor','store_keeper']) $$;
create or replace function my_person(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from project_members where project_id = p and user_id = auth.uid() and active
$$;
create or replace function my_supplier(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select supplier_id from project_members where project_id = p and user_id = auth.uid() and active
$$;
create or replace function haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;
-- An active person may work on site; a pending / blocked / inactive one may not.
create or replace function person_ok(p_person uuid, p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when pe.id is null then 'not registered on this project'
    when pe.status <> 'active' then 'status is ' || pe.status
    when pe.btk_card_expiry is not null and pe.btk_card_expiry < current_date then 'BTK card expired'
    when pe.cnic_expiry is not null and pe.cnic_expiry < current_date then 'CNIC expired'
    else null end
  from (select 1) x left join people pe on pe.id = p_person and pe.project_id = p_project
$$;


-- ---------- evidence: flags computed on the server ---------------------------
create or replace function evidence_flags() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr projects; dv devices; f text[] := '{}';
begin
  select * into pr from projects where id = new.project_id;
  if new.device_id is not null then select * into dv from devices where id = new.device_id; end if;
  new.received_at := now();
  if new.lat is null or new.lng is null then f := array_append(f, 'no_gps');
  elsif pr.site_lat is not null then
    new.distance_m := haversine_m(new.lat, new.lng, pr.site_lat, pr.site_lng);
    if new.distance_m > pr.site_radius_m then f := array_append(f, 'away_from_site'); end if;
  end if;
  if coalesce(new.mocked, false) then f := array_append(f, 'mocked_location'); end if;
  if new.accuracy_m is not null and new.accuracy_m > pr.max_gps_accuracy_m then f := array_append(f, 'low_gps_accuracy'); end if;
  if abs(extract(epoch from (new.received_at - new.captured_at))) > pr.max_photo_age_min * 60 then f := array_append(f, 'clock_skew_or_old_photo'); end if;
  if dv.id is null then f := array_append(f, 'unknown_device'); elsif not dv.approved then f := array_append(f, 'unapproved_device'); end if;
  if new.integrity = 'failed' then f := array_append(f, 'integrity_failed'); end if;
  new.flags := coalesce(new.flags, '{}') || f;   -- the ingest function may add flags (e.g. device_of_other_user)
  return new;
end $$;
create trigger evidence_flags before insert on evidence for each row execute function evidence_flags();

-- Evidence used for stock and receipts must be clean; attendance records flags instead.
create or replace function assert_clean_evidence(e uuid, p_project uuid, purposes text[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare ev evidence;
begin
  if e is null then raise exception 'A photo taken in the app is required'; end if;
  select * into ev from evidence where id = e;
  if ev.id is null or ev.project_id <> p_project then raise exception 'Photo not found for this project'; end if;
  if not (ev.purpose = any (purposes)) then raise exception 'Photo was taken for %, not %', ev.purpose, purposes; end if;
  if ev.user_id <> auth.uid() then raise exception 'Photo must be taken by the person recording the entry'; end if;
  if ev.flags && array['no_gps','away_from_site','mocked_location','clock_skew_or_old_photo','unknown_device','unapproved_device','integrity_failed','device_of_other_user'] then
    raise exception 'Photo rejected: %', array_to_string(ev.flags, ', ');
  end if;
  if exists (select 1 from stock_moves where evidence_id = e) or exists (select 1 from grns where bill_evidence_id = e or truck_evidence_id = e)
     or exists (select 1 from water_tankers where bill_evidence_id = e or tanker_evidence_id = e) or exists (select 1 from stock_counts where evidence_id = e) then
    raise exception 'This photo has already been used for another entry';
  end if;
end $$;

-- ---------- stock ---------------------------------------------------------
create or replace view v_stock_on_hand with (security_invoker = true) as
select m.project_id, m.id as material_id, m.name, m.kind, m.unit,
  coalesce(sum(s.qty) filter (where s.kind = 'receipt'), 0)    as received,
  coalesce(sum(s.qty) filter (where s.kind = 'release'), 0)    as released,
  coalesce(sum(s.qty) filter (where s.kind = 'return'), 0)     as returned,
  coalesce(sum(s.qty) filter (where s.kind = 'lost'), 0)       as lost,
  coalesce(sum(s.qty) filter (where s.kind = 'adjustment'), 0) as adjusted,
  coalesce(sum(case s.kind when 'receipt' then s.qty when 'return' then s.qty when 'adjustment' then s.qty when 'release' then -s.qty else 0 end), 0) as on_hand
from materials m left join stock_moves s on s.material_id = m.id
group by m.project_id, m.id, m.name, m.kind, m.unit;

create or replace function on_hand(p_material uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case kind when 'receipt' then qty when 'return' then qty when 'adjustment' then qty when 'release' then -qty else 0 end), 0)
  from stock_moves where material_id = p_material
$$;
create or replace function held_by(p_material uuid, p_person uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case kind when 'release' then qty when 'return' then -qty when 'lost' then -qty else 0 end), 0)
  from stock_moves where material_id = p_material and person_id = p_person
$$;

create or replace function stock_moves_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text; auth_type text; me uuid; mat materials;
begin
  new.created_by := auth.uid(); new.at := now();
  select * into mat from materials where id = new.material_id and project_id = new.project_id for update;   -- serialises releases per item
  if mat.id is null then raise exception 'Item not in this project'; end if;
  if new.kind = 'receipt' then
    if new.grn_id is null then raise exception 'Receipts are created from a goods received note'; end if;
    return new;
  end if;
  if new.kind = 'adjustment' then
    if not has_role(new.project_id, array['owner']) then raise exception 'Only the owner can adjust stock'; end if;
    return new;
  end if;
  -- release / return / lost: registered people only, photo evidence, store keeper = the signed-in registered user
  if new.person_id is null then raise exception 'Choose the registered person receiving or returning the item'; end if;
  why := person_ok(new.person_id, new.project_id); if why is not null then raise exception 'Receiver: %', why; end if;
  if new.authorised_by is null then raise exception 'Choose who authorised this'; end if;
  why := person_ok(new.authorised_by, new.project_id); if why is not null then raise exception 'Authoriser: %', why; end if;
  select type into auth_type from people where id = new.authorised_by;
  if auth_type in ('labour','guard','cook','driver') then raise exception 'A % cannot authorise a release', auth_type; end if;
  me := my_person(new.project_id);
  why := person_ok(me, new.project_id); if why is not null then raise exception 'You (store keeper): %', why; end if;
  new.store_keeper := me;
  perform assert_clean_evidence(new.evidence_id, new.project_id, array['release']);
  if new.kind = 'release' and new.qty > on_hand(new.material_id) then
    raise exception 'Only % % in store', on_hand(new.material_id), mat.unit;
  end if;
  if new.kind in ('return','lost') and mat.kind = 'tool' and new.qty > held_by(new.material_id, new.person_id) then
    raise exception 'This person holds only % of this tool', held_by(new.material_id, new.person_id);
  end if;
  return new;
end $$;
create trigger stock_moves_rules before insert on stock_moves for each row execute function stock_moves_rules();

create or replace function grns_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  new.created_by := auth.uid(); new.at := now();
  why := person_ok(new.received_by, new.project_id); if why is not null then raise exception 'Received by: %', why; end if;
  perform assert_clean_evidence(new.bill_evidence_id, new.project_id, array['receipt_bill']);
  if new.truck_evidence_id is not null then perform assert_clean_evidence(new.truck_evidence_id, new.project_id, array['receipt_truck']); end if;
  if new.po_id is not null and not exists (select 1 from purchase_orders where id = new.po_id and project_id = new.project_id and status in ('approved','issued','delivered')) then
    raise exception 'The purchase order is not approved';
  end if;
  return new;
end $$;
create trigger grns_rules before insert on grns for each row execute function grns_rules();

create or replace function grns_to_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.qty_accepted > 0 then
    insert into stock_moves (project_id, material_id, kind, qty, grn_id, created_by, note)
    values (new.project_id, new.material_id, 'receipt', new.qty_accepted, new.id, new.created_by, 'GRN ' || new.no);
  end if;
  return new;
end $$;
create trigger grns_to_stock after insert on grns for each row execute function grns_to_stock();

create or replace function tankers_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  new.created_by := auth.uid(); new.at := now();
  why := person_ok(new.received_by, new.project_id); if why is not null then raise exception 'Received by: %', why; end if;
  perform assert_clean_evidence(new.tanker_evidence_id, new.project_id, array['tanker']);
  perform assert_clean_evidence(new.bill_evidence_id, new.project_id, array['tanker_bill']);
  return new;
end $$;
create trigger tankers_rules before insert on water_tankers for each row execute function tankers_rules();

create or replace function counts_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  new.at := now(); new.counted_by := my_person(new.project_id);
  why := person_ok(new.counted_by, new.project_id); if why is not null then raise exception 'You: %', why; end if;
  perform assert_clean_evidence(new.evidence_id, new.project_id, array['count']);
  new.book_qty := on_hand(new.material_id);
  return new;
end $$;
create trigger counts_rules before insert on stock_counts for each row execute function counts_rules();

-- ---------- attendance: only through this function ----------------------------
create or replace function mark_attendance(p_project uuid, p_badge_token uuid, p_face_evidence uuid, p_badge_evidence uuid, p_direction text)
returns attendance language plpgsql security definer set search_path = public as $$
declare pe people; ev evidence; f text[] := '{}'; why text; me uuid; rec attendance; d date;
begin
  if not has_role(p_project, array['owner','owner_supervisor','site_supervisor','store_keeper']) then raise exception 'Not allowed to mark attendance'; end if;
  me := my_person(p_project); why := person_ok(me, p_project); if why is not null then raise exception 'You: %', why; end if;
  select * into pe from people where badge_token = p_badge_token and project_id = p_project;
  if pe.id is null then raise exception 'Badge not recognised (lost or old badge?)'; end if;
  select * into ev from evidence where id = p_face_evidence and project_id = p_project;
  if ev.id is null or ev.purpose <> 'attendance' or ev.user_id <> auth.uid() then raise exception 'A face photo taken in the app now is required'; end if;
  if exists (select 1 from attendance where face_evidence_id = p_face_evidence) then raise exception 'This photo was already used'; end if;
  why := person_ok(pe.id, p_project); if why is not null then f := f || why; end if;
  f := f || ev.flags;
  d := (now() at time zone (select timezone from projects where id = p_project))::date;
  insert into attendance (project_id, person_id, work_date, direction, badge_evidence_id, face_evidence_id, badge_token_ok, marked_by, status, flags)
  values (p_project, pe.id, d, p_direction, p_badge_evidence, p_face_evidence, true, auth.uid(), case when cardinality(f) = 0 then 'pending' else 'flagged' end, f)
  returning * into rec;
  return rec;   -- 'pending' becomes 'verified' or 'flagged' after the verify-face function compares faces
end $$;

-- owner's decision on flagged rows: only status / decided_* may change
create or replace function attendance_update_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status','decided_by','decided_at','face_match','flags']) <> (to_jsonb(old) - array['status','decided_by','decided_at','face_match','flags']) then
    raise exception 'Attendance evidence cannot be edited';
  end if;
  if auth.uid() is not null then new.decided_by := auth.uid(); new.decided_at := now(); end if;
  return new;
end $$;
create trigger attendance_update_guard before update on attendance for each row execute function attendance_update_guard();

-- ---------- people: self-registration stays pending until the owner's side verifies ----
create or replace function people_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if not has_role(new.project_id, array['owner','owner_supervisor']) then
    if tg_op = 'INSERT' then new.status := 'pending'; new.verified_by := null; new.verified_at := null;
    elsif new.status is distinct from old.status or new.badge_token is distinct from old.badge_token or new.daily_wage is distinct from old.daily_wage then
      raise exception 'Only the owner''s side can verify, block or change wages';
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status <> 'active' then
    new.verified_by := auth.uid(); new.verified_at := now();
  end if;
  return new;
end $$;
create trigger people_rules before insert or update on people for each row execute function people_rules();
-- a person record carrying a login is linked to that member automatically
create or replace function people_link_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    update project_members set person_id = new.id where project_id = new.project_id and user_id = new.user_id and person_id is null;
  end if;
  return new;
end $$;
create trigger people_link_member after insert or update of user_id on people for each row execute function people_link_member();

create or replace function logs_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from unnest(new.staff_present) s where person_ok(s, new.project_id) is not null) then
    raise exception 'Only registered, active people can be recorded as present';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger logs_rules before insert or update on daily_logs for each row execute function logs_rules();

create or replace function devices_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- server functions (service role) set these fields themselves
  if not has_role(new.project_id, array['owner']) then
    if tg_op = 'INSERT' then new.approved := false; new.approved_by := null; new.user_id := auth.uid();
    elsif new.approved is distinct from old.approved then raise exception 'Only the owner approves devices'; end if;
  elsif tg_op = 'UPDATE' and new.approved and not old.approved then new.approved_by := auth.uid(); end if;
  return new;
end $$;
create trigger devices_rules before insert or update on devices for each row execute function devices_rules();

create or replace function suppliers_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not has_role(new.project_id, array['owner','builder']) then
    if tg_op = 'INSERT' then new.status := 'pending'; new.registered_by := auth.uid();
    elsif new.status is distinct from old.status then raise exception 'Only the owner or builder approves suppliers'; end if;
  end if;
  return new;
end $$;
create trigger suppliers_rules before insert or update on suppliers for each row execute function suppliers_rules();

create or replace function po_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); if not has_role(new.project_id, array['owner']) then new.status := 'pending_approval'; end if; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and old.status = 'pending_approval' and not has_role(new.project_id, array['owner']) then
    raise exception 'Only the owner approves purchase orders';
  end if;
  if tg_op = 'UPDATE' and new.status in ('approved','issued') and old.status = 'pending_approval' then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  if not exists (select 1 from suppliers where id = new.supplier_id and status = 'approved') then raise exception 'Supplier is not approved'; end if;
  return new;
end $$;
create trigger po_rules before insert or update on purchase_orders for each row execute function po_rules();

-- the creator of a project becomes its owner
create or replace function projects_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into project_members (project_id, user_id, role, added_by) values (new.id, auth.uid(), 'owner', auth.uid());
  return new;
end $$;
create trigger projects_owner after insert on projects for each row execute function projects_owner();

-- ---------- audit trail ---------------------------------------------------------
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (project_id, table_name, row_id, action, actor, old_row, new_row)
  values (coalesce((to_jsonb(new) ->> 'project_id')::uuid, (to_jsonb(old) ->> 'project_id')::uuid), tg_table_name,
          coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid), tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['people','project_members','devices','attendance','stock_moves','grns','water_tankers','stock_counts','purchase_orders','suppliers','inspections','contracts','materials'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;

-- ---------- analysis views ----------------------------------------------------
create or replace function phase_progress(p uuid, ph text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(weight * coalesce(verified_pct, reported_pct, 0)) / nullif(sum(weight), 0) / 100, 0)
  from stages where project_id = p and phase = ph
$$;
create or replace view v_consumption with (security_invoker = true) as
with md as (
  select project_id, count(*) filter (where status in ('verified','approved') and direction = 'in') as man_days from attendance group by project_id
)
select s.project_id, s.material_id, s.name, s.kind, s.unit, s.received, s.released - s.returned as used_net, s.lost, s.on_hand,
  case when m.kind = 'canteen' and m.norm_per_man_day is not null then m.norm_per_man_day * coalesce(md.man_days, 0)
       when m.kind in ('material','consumable') and m.budget_qty is not null and m.phase in ('grey','finishing') then m.budget_qty * phase_progress(m.project_id, m.phase)
  end as expected_by_now
from v_stock_on_hand s join materials m on m.id = s.material_id left join md on md.project_id = s.project_id;

create or replace view v_tool_holdings with (security_invoker = true) as
select m.project_id, m.id as material_id, m.name, sm.person_id, held_by(m.id, sm.person_id) as held, max(sm.at) filter (where sm.kind = 'release') as last_out, m.return_days
from materials m join stock_moves sm on sm.material_id = m.id and sm.person_id is not null
where m.kind = 'tool' group by m.project_id, m.id, m.name, sm.person_id, m.return_days having held_by(m.id, sm.person_id) > 0;

-- badge QR -> person (the badge token itself is never exposed in lists)
create or replace function resolve_badge(p_project uuid, p_token uuid) returns table (id uuid, full_name text, type text, trade text, gang text, status text, problem text)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.full_name, pe.type, pe.trade, pe.gang, pe.status, person_ok(pe.id, p_project)
  from people pe where pe.project_id = p_project and pe.badge_token = p_token and is_staff(p_project)
$$;
grant execute on function resolve_badge(uuid, uuid) to authenticated;

-- directory of people without CNIC, wage and address for roles that don't need them
create or replace view people_directory as
select id, project_id, full_name, type, trade, gang, btk_card_no, btk_card_expiry, status, badge_token is not null as has_badge,
       regexp_replace(cnic, '^([0-9]{5})-[0-9]{7}-([0-9])$', '\1-*******-\2') as cnic_masked
from people where is_member(project_id);
grant select on people_directory to authenticated;

-- ---------- row-level security ---------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['organizations','profiles','projects','parties','project_members','people','person_docs','devices','evidence','attendance','suppliers','materials','stages','tasks','rfqs','quotes','purchase_orders','grns','stock_moves','water_tankers','stock_counts','daily_logs','inspections','checklists','issues_register','contracts','audit_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy org_read on organizations for select using (created_by = auth.uid() or exists (select 1 from projects pr where pr.org_id = organizations.id and is_member(pr.id)));
create policy org_create on organizations for insert to authenticated with check (created_by = auth.uid());
create policy org_edit on organizations for update using (created_by = auth.uid());
create policy profile_self on profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_team on profiles for select using (exists (select 1 from project_members a join project_members b on a.project_id = b.project_id where a.user_id = auth.uid() and b.user_id = profiles.user_id));
create policy project_read on projects for select using (is_member(id) or created_by = auth.uid());
create policy project_create on projects for insert to authenticated with check (created_by = auth.uid());
create policy project_edit on projects for update using (has_role(id, array['owner']));
create policy parties_read on parties for select using (is_member(project_id));
create policy parties_write on parties for all using (has_role(project_id, array['owner'])) with check (has_role(project_id, array['owner']));
create policy members_read on project_members for select using (is_member(project_id));
create policy members_write on project_members for all using (has_role(project_id, array['owner'])) with check (has_role(project_id, array['owner']));

create policy people_full on people for select using (has_role(project_id, array['owner','owner_supervisor']) or user_id = auth.uid());
create policy people_add on people for insert with check (is_staff(project_id) or (user_id = auth.uid() and is_member(project_id)));
create policy people_edit on people for update using (has_role(project_id, array['owner','owner_supervisor']) or (user_id = auth.uid() and status = 'pending'));
create policy pdocs_read on person_docs for select using (exists (select 1 from people p where p.id = person_id and (has_role(p.project_id, array['owner','owner_supervisor']) or p.user_id = auth.uid())));
create policy pdocs_add on person_docs for insert with check (exists (select 1 from people p where p.id = person_id and (is_staff(p.project_id) or p.user_id = auth.uid())));

create policy devices_read on devices for select using (user_id = auth.uid() or has_role(project_id, array['owner']));
create policy devices_add on devices for insert with check (is_member(project_id));
create policy devices_edit on devices for update using (user_id = auth.uid() or has_role(project_id, array['owner']));

create policy evidence_read on evidence for select using (is_member(project_id) and not has_role(project_id, array['supplier']));
-- no insert / update / delete policies: only the ingest-evidence function (service role) writes evidence

create policy att_read on attendance for select using (is_staff(project_id));
create policy att_decide on attendance for update using (has_role(project_id, array['owner','owner_supervisor']));

create policy sup_read on suppliers for select using (is_staff(project_id) or registered_by = auth.uid() or id = my_supplier(project_id));
create policy sup_register on suppliers for insert with check (is_member(project_id));
create policy sup_edit on suppliers for update using (has_role(project_id, array['owner','builder']) or (registered_by = auth.uid() and status = 'pending'));

create policy mat_read on materials for select using (is_member(project_id));
create policy mat_write on materials for all using (has_role(project_id, array['owner','builder'])) with check (has_role(project_id, array['owner','builder']));
create policy stages_read on stages for select using (is_member(project_id));
create policy stages_write on stages for all using (has_role(project_id, array['owner','owner_supervisor','builder'])) with check (has_role(project_id, array['owner','owner_supervisor','builder']));
create policy tasks_read on tasks for select using (is_member(project_id));
create policy tasks_write on tasks for all using (has_role(project_id, array['owner','builder'])) with check (has_role(project_id, array['owner','builder']));

create policy rfq_read on rfqs for select using (is_staff(project_id) or (my_supplier(project_id) = any (invited_supplier_ids) and status = 'open'));
create policy rfq_write on rfqs for all using (has_role(project_id, array['owner','builder'])) with check (has_role(project_id, array['owner','builder']));
create policy quote_read on quotes for select using (has_role(project_id, array['owner','owner_supervisor','builder']) or supplier_id = my_supplier(project_id));
create policy quote_add on quotes for insert with check (has_role(project_id, array['owner','builder']) or (supplier_id = my_supplier(project_id) and exists (select 1 from rfqs r where r.id = rfq_id and supplier_id = any (r.invited_supplier_ids) and r.status = 'open')));
create policy quote_edit on quotes for update using (has_role(project_id, array['owner','builder']) or (supplier_id = my_supplier(project_id) and status = 'submitted'));
create policy po_read on purchase_orders for select using (is_staff(project_id) or (supplier_id = my_supplier(project_id) and status <> 'pending_approval'));
create policy po_write on purchase_orders for insert with check (has_role(project_id, array['owner','builder']));
create policy po_edit on purchase_orders for update using (has_role(project_id, array['owner','builder']));

create policy grn_read on grns for select using (is_staff(project_id));
create policy grn_add on grns for insert with check (has_role(project_id, array['owner','owner_supervisor','site_supervisor','store_keeper','builder']));
create policy moves_read on stock_moves for select using (is_staff(project_id));
create policy moves_add on stock_moves for insert with check (has_role(project_id, array['owner','owner_supervisor','site_supervisor','store_keeper','builder']));
create policy water_read on water_tankers for select using (is_staff(project_id));
create policy water_add on water_tankers for insert with check (has_role(project_id, array['owner','owner_supervisor','site_supervisor','store_keeper']));
create policy counts_read on stock_counts for select using (is_staff(project_id));
create policy counts_add on stock_counts for insert with check (has_role(project_id, array['owner','owner_supervisor','site_supervisor','store_keeper']));

create policy logs_read on daily_logs for select using (is_staff(project_id) or has_role(project_id, array['consultant']));
create policy logs_write on daily_logs for all using (has_role(project_id, array['owner','owner_supervisor','site_supervisor','builder'])) with check (has_role(project_id, array['owner','owner_supervisor','site_supervisor','builder']));
create policy insp_read on inspections for select using (is_staff(project_id) or has_role(project_id, array['consultant']));
create policy insp_add on inspections for insert with check (is_staff(project_id) or has_role(project_id, array['consultant']));
create policy insp_edit on inspections for update using (has_role(project_id, array['owner','owner_supervisor','consultant']));
create policy cl_all on checklists for all using (is_staff(project_id)) with check (is_staff(project_id));
create policy iss_read on issues_register for select using (is_staff(project_id) or has_role(project_id, array['consultant']));
create policy iss_write on issues_register for all using (is_staff(project_id)) with check (is_staff(project_id));
create policy contracts_owner on contracts for all using (has_role(project_id, array['owner'])) with check (has_role(project_id, array['owner']));
create policy audit_owner on audit_log for select using (has_role(project_id, array['owner']));

grant execute on function mark_attendance(uuid, uuid, uuid, uuid, text) to authenticated;
