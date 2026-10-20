-- Fine-tuning of 20 Oct 2026: labour rates readable only with wage rights, partner audits,
-- progress verification and worker approval kept with the owner's side.

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
    when c in ('milestones','stages','subtasks','payments','budget','changes','contracts','pettycash','suppliers','materials','rfqs','quotes','pos','dns','grns','returns','issues','counts','water','inspections','checklists','snags','drawings','risks','logs','attendance','camera','people','members','audits') then c
    else null end $$;

create or replace function app_can_read(p uuid, c text, i text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p); prof jsonb; rk text; mk text; lv int; mv int;
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if c = 'config' and i = 'rates' then
    prof := app_profile(p); return prof is not null and app_money_level(prof->'money'->>'wages') >= 4;
  end if;
  if c in ('members', 'audit', 'parties', 'config') then return true; end if;
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

-- only the owner or the owner's supervisor may change verified progress
create or replace function app_stage_verify_sig(d jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(nullif(d->>'verified', ''), nullif(d->>'verifiedBy', ''),
    (select jsonb_agg(jsonb_build_array(nullif(x->>'verified', ''), nullif(x->>'verifiedBy', ''))) filter (where nullif(x->>'verified', '') is not null or nullif(x->>'verifiedBy', '') is not null)
       from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) x)) $$;
create or replace function app_stage_verify_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text; base text;
begin
  if new.col <> 'stages' then return new; end if;
  r := app_role(new.project_id);
  if r is null or r = 'owner' or r = 'owner_supervisor' then return new; end if;
  base := (select c.data->'profiles'->(app_member_doc(new.project_id)->>'role')->>'base' from app_records c where c.project_id = new.project_id and c.col = 'config' and c.id = 'access');
  if base = 'owner_supervisor' then return new; end if;
  if app_stage_verify_sig(new.data) is distinct from (case when tg_op = 'INSERT' then app_stage_verify_sig('{}'::jsonb) else app_stage_verify_sig(old.data) end) then
    raise exception 'Only the owner or the owner''s supervisor can verify progress' using errcode = '42501'; end if;
  return new;
end $$;
create or replace trigger app_stage_verify_guard before insert or update on app_records for each row execute function app_stage_verify_guard();

-- workers entered by partners and staff stay Pending until the owner's side approves them
create or replace function app_people_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text; base text;
begin
  if new.col <> 'people' then return new; end if;
  r := app_role(new.project_id);
  if r is null or r in ('owner', 'owner_supervisor') then return new; end if;
  base := (select c.data->'profiles'->(app_member_doc(new.project_id)->>'role')->>'base' from app_records c where c.project_id = new.project_id and c.col = 'config' and c.id = 'access');
  if base = 'owner_supervisor' then return new; end if;
  if tg_op = 'INSERT' and coalesce(nullif(new.data->>'status', ''), 'Pending') <> 'Pending' then
    raise exception 'New workers stay Pending until the owner or the owner''s supervisor approves them' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and coalesce(new.data->>'status', '') is distinct from coalesce(old.data->>'status', '') then
    raise exception 'Only the owner or the owner''s supervisor can approve or block a worker' using errcode = '42501'; end if;
  return new;
end $$;
create or replace trigger app_people_guard before insert or update on app_records for each row execute function app_people_guard();

-- partners see and enter only their own tasks, people, attendance and snags; audits screen
update app_records set data = jsonb_set(data, '{profiles}', (
  select jsonb_object_agg(k, case
    when k in ('sb','consultant','supplier') then
      jsonb_set(jsonb_set(v, '{records}', (v->'records') || '{"milestones":"Own only","subtasks":"Own only","people":"Own only","attendance":"Own only","snags":"Own only","audits":"Own only"}'::jsonb || case when k = 'supplier' then '{"drawings":"View"}'::jsonb else '{}'::jsonb end),
        '{screens}', (v->'screens') || '{"audits":"Yes"}'::jsonb || case when k = 'supplier' then '{"people":"Yes","attendance":"Yes","snags":"Yes","schedule":"Yes"}'::jsonb when k = 'consultant' then '{"people":"Yes","attendance":"Yes"}'::jsonb else '{}'::jsonb end)
    when k = 'owner' then jsonb_set(jsonb_set(v, '{screens,audits}', '"Yes"'), '{records,audits}', '"Add, edit, delete"')
    when k = 'ownerSup' then jsonb_set(jsonb_set(v, '{screens,audits}', '"Yes"'), '{records,audits}', '"Add & edit"')
    when k = 'siteSup' then jsonb_set(jsonb_set(v, '{screens,audits}', '"—"'), '{records,audits}', '"View"')
    else jsonb_set(jsonb_set(v, '{screens,audits}', '"—"'), '{records,audits}', '"—"') end)
  from jsonb_each(data->'profiles') e(k, v)))
where col = 'config' and id = 'access';
