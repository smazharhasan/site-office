-- Access profiles, edited by the owner in Project settings → Access control.
-- The owner's matrix (config record "access") decides, on the server, which records and which amounts
-- each profile may read and write. A user's profile is the "role" on their members record.
-- The owner always has full access and cannot be locked out.

create or replace function app_rec_level(v text) returns int language sql immutable as $$
  select case v when 'Add, edit, delete' then 5 when 'Add & edit' then 4 when 'Own only' then 3 when 'View' then 2 else 1 end $$;
create or replace function app_money_level(v text) returns int language sql immutable as $$
  select case v when 'Full + approve' then 6 when 'Full · post' then 5 when 'Full · view' then 4 when 'Own · post' then 3 when 'Own · view' then 2 else 1 end $$;

-- which matrix row governs a collection, and which money row (if any)
create or replace function app_rec_key(c text) returns text language sql immutable as $$
  select case
    when c in ('selections') then 'changes'
    when c in ('contractText') then 'contracts'
    when c in ('tank') then 'water'
    when c in ('peopleDocs') then 'people'
    when c in ('config', 'reports') then 'settings'
    when c = 'changesMoney' then 'changes' when c = 'selectionsMoney' then 'changes' when c = 'posMoney' then 'pos'
    when c = 'materialsMoney' then 'materials' when c = 'grnsMoney' then 'grns' when c = 'waterMoney' then 'water'
    when c = 'peopleMoney' then 'people' when c = 'risksMoney' then 'risks'
    when c in ('milestones','stages','subtasks','payments','budget','changes','contracts','pettycash','suppliers','materials','rfqs','quotes','pos','dns','grns','returns','issues','counts','water','inspections','checklists','snags','drawings','risks','logs','attendance','camera','people','members') then c
    else null end $$;
create or replace function app_money_key(c text) returns text language sql immutable as $$
  select case c
    when 'budget' then 'budget' when 'contracts' then 'contractValue' when 'contractText' then 'contractValue'
    when 'payments' then 'payments' when 'changesMoney' then 'changeCost' when 'selectionsMoney' then 'selections'
    when 'quotes' then 'quotes' when 'posMoney' then 'poPrices' when 'materialsMoney' then 'matRates'
    when 'grnsMoney' then 'grnBill' when 'pettycash' then 'pettycash' when 'waterMoney' then 'water'
    when 'peopleMoney' then 'wages' when 'risksMoney' then 'riskCost' else null end $$;

-- the signed-in person's access profile
create or replace function app_profile(p uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select c.data->'profiles'->(app_member_doc(p)->>'role')
  from app_records c where c.project_id = p and c.col = 'config' and c.id = 'access' $$;

-- is this record the person's own (their company's, or assigned to them)?
create or replace function app_is_own(p uuid, c text, i text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare m jsonb := app_member_doc(p);
begin
  if m is null or d is null then return false; end if;
  if c = 'people' and d->>'userId' = auth.uid()::text then return true; end if;
  if c = 'suppliers' and coalesce(m->>'supplierId', '') <> '' and i = m->>'supplierId' then return true; end if;
  if c = 'parties' and coalesce(m->>'partyId', '') <> '' and i = m->>'partyId' then return true; end if;
  return coalesce(app_is_mine(p, d), false) or coalesce(app_is_my_person(p, d), false);
end $$;

create or replace function app_can_read(p uuid, c text, i text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p); prof jsonb; rk text; mk text; lv int; mv int;
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if c in ('members', 'audit', 'parties') or (c = 'config' and i <> 'access') then return true; end if;
  if c = 'config' and i = 'access' then return true; end if;           -- everyone may read the rules that apply to them
  prof := app_profile(p); if prof is null then return false; end if;
  rk := app_rec_key(c); if rk is null then return false; end if;
  lv := app_rec_level(prof->'records'->>rk);
  if lv < 2 or (lv = 3 and not app_is_own(p, c, i, d)) then return false; end if;
  mk := app_money_key(c);
  if mk is not null then
    mv := app_money_level(prof->'money'->>mk);
    if mv < 2 or (mv < 4 and not app_is_own(p, c, i, d)) then return false; end if;
  end if;
  return true;
end $$;

create or replace function app_can_write(p uuid, c text, i text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p); prof jsonb; rk text; mk text; lv int; mv int;
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if c = 'audit' then return true; end if;
  if c in ('members', 'parties') or c = 'config' then return false; end if;  -- logins, partners and settings: owner only
  prof := app_profile(p); if prof is null then return false; end if;
  rk := app_rec_key(c); if rk is null then return false; end if;
  lv := app_rec_level(prof->'records'->>rk);
  if lv < 3 or (lv = 3 and not app_is_own(p, c, i, d)) then return false; end if;
  mk := app_money_key(c);
  if mk is not null then
    mv := app_money_level(prof->'money'->>mk);
    if mv not in (3, 5, 6) or (mv = 3 and not app_is_own(p, c, i, d)) then return false; end if;
  end if;
  return true;
end $$;

create or replace function app_can_delete(p uuid, c text, i text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare prof jsonb;
begin
  if app_role(p) = 'owner' then return true; end if;
  prof := app_profile(p); if prof is null or app_rec_key(c) is null then return false; end if;
  return app_rec_level(prof->'records'->>app_rec_key(c)) = 5 and app_can_write(p, c, i, d);
end $$;


-- the owner's matrix of 20 Oct 2026 (one character per cell, expanded to the full labels)
with k as (select '{dashboard,progress,partners,schedule,payments,budget,changes,pettycash,stores,procurement,suppliers,contracts,supplierPortal,risks,quality,snags,attendance,checklists,sitelog,camera,assistant,people,settings}'::text[] s, '{milestones,stages,subtasks,payments,budget,changes,contracts,pettycash,suppliers,materials,rfqs,quotes,pos,dns,grns,returns,issues,counts,water,inspections,checklists,snags,drawings,risks,logs,attendance,camera,people,members,settings}'::text[] r, '{budget,market,cashflow,contractValue,payments,changeCost,selections,dashTiles,quotes,poPrices,matRates,grnBill,pettycash,water,wages,riskCost}'::text[] m, '{attendance,release,receive,tanker,count,daily-log,stock,review,people,team,office}'::text[] ph),
v(key,label,base,s,r,m,ph) as (values

('owner','Owner','owner','YYYYYYYYYYYYYYYYYYYYYYY','555555555555555555555555555555','6666666666666666','YYYYYYYYYYY'),
('ownerSup','Owner''s supervisor','owner_supervisor','YYNYNNYYYYYNNYYYYYYYYYN','244112142421224444444444444411','1111111111155111','YYYYYYYYYNY'),
('siteSup','Site supervisor','site_supervisor','YYNYNNYYYNNNNYYYYYYYNYN','244112141411244444444424444411','1111111111155111','YYYYYYYNNNY'),
('storeKeeper','Store keeper','store_keeper','NYNYNNNYYNNNNNNYYYNYNYN','222111141411244444412221144411','1111111111155111','YYYYYNYNNNY'),
('sb','Builder','builder','YYNYYNYNYYYNNYYYYYYYYYN','444313114443444442444444444411','1111333233111111','NYYNNYYNNNY'),
('consultant','Consultant','consultant','YYNYYNYNNNNNNYYYNYYYNNN','224313111111111111144424414111','1111333211111111','NNNNNNNNNNY'),
('supplier','Supplier','supplier','NNNNNNNNNNNNYNNNNNNNNNN','111111113123331111111111111111','1111111132111111','NNNNNNNNNNY'),
('labour','Labour','labour','NNNNNNNNNNNNNNNYYNNNNNN','133111111111111111113321134311','1111111111111111','NNNNNNNNNNY')),
prof as (select v.key, jsonb_build_object('label', v.label, 'base', v.base, 'builtin', true,
  'screens', (select jsonb_object_agg(k.s[i], case substr(v.s,i,1) when 'Y' then 'Yes' else '—' end) from generate_subscripts(k.s,1) i),
  'records', (select jsonb_object_agg(k.r[i], case substr(v.r,i,1) when '5' then 'Add, edit, delete' when '4' then 'Add & edit' when '3' then 'Own only' when '2' then 'View' else '—' end) from generate_subscripts(k.r,1) i),
  'money', (select jsonb_object_agg(k.m[i], case substr(v.m,i,1) when '6' then 'Full + approve' when '5' then 'Full · post' when '4' then 'Full · view' when '3' then 'Own · post' when '2' then 'Own · view' else 'None' end) from generate_subscripts(k.m,1) i),
  'phone', (select jsonb_object_agg(k.ph[i], case substr(v.ph,i,1) when 'Y' then 'Yes' else '—' end) from generate_subscripts(k.ph,1) i)) j from v, k)
insert into app_records (project_id, col, id, data)
select pr.id, 'config', 'access', jsonb_build_object('profiles', (select jsonb_object_agg(key, j) from prof), 'updatedAt', now(), 'note', 'Set from the role matrix the owner sent on 20 Oct 2026') from projects pr
on conflict (project_id, col, id) do nothing;

alter policy app_records_read on app_records using (app_can_read(project_id, col, id, data));
alter policy app_records_insert on app_records with check (app_can_write(project_id, col, id, data));
alter policy app_records_update on app_records using (app_can_write(project_id, col, id, data)) with check (app_can_write(project_id, col, id, data));
alter policy app_records_delete on app_records using (app_can_delete(project_id, col, id, data));

revoke all on function app_profile(uuid), app_is_own(uuid, text, text, jsonb), app_can_read(uuid, text, text, jsonb), app_can_write(uuid, text, text, jsonb), app_can_delete(uuid, text, text, jsonb) from public, anon;
grant execute on function app_profile(uuid), app_is_own(uuid, text, text, jsonb), app_can_read(uuid, text, text, jsonb), app_can_write(uuid, text, text, jsonb), app_can_delete(uuid, text, text, jsonb) to authenticated;
