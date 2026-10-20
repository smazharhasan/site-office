-- Role matrix agreed on 20 Oct 2026.
--   Supervisors may now open Changes & selections, but the amounts (cost, allowance, prices) move to
--   separate "…Money" records that only the owner and the partner concerned can read.
--   Labour sees only what is assigned to them: their snags, sub-tasks, checklists and attendance.
--   Only the owner deletes records.

create or replace function app_is_my_person(p uuid, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare m jsonb := app_member_doc(p); me text;
begin
  if m is null or d is null then return false; end if;
  me := coalesce(m->>'personId', '');
  if me = '' then select id into me from app_records where project_id = p and col = 'people' and data->>'userId' = auth.uid()::text limit 1; end if;
  return coalesce(me, '') <> '' and (d->>'personId' = me or d->>'ownerId' = me);
end $$;

create or replace function app_can_read(p uuid, c text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p);
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if r = 'labour' then
    if c in ('config', 'members', 'people', 'peopleDocs', 'stages', 'drawings', 'audit') then return true; end if;
    if c in ('snags', 'subtasks', 'checklists', 'attendance') then return app_is_my_person(p, d); end if;
    return false;
  end if;
  if c in ('budget', 'contractText', 'reports', 'materialsMoney', 'waterMoney', 'risksMoney', 'peopleMoney') then return false; end if;
  if c in ('pettycash', 'grnsMoney') then return r in ('owner_supervisor', 'site_supervisor', 'store_keeper'); end if;
  if c in ('changes', 'selections') and r in ('owner_supervisor', 'site_supervisor') then return true; end if;  -- view, amounts hidden
  if c in ('payments', 'contracts', 'changes', 'selections', 'changesMoney', 'selectionsMoney', 'posMoney', 'quotes') then
    return r in ('builder', 'consultant', 'supplier') and app_is_mine(p, d);
  end if;
  if c = 'pos' then
    if r = 'supplier' then return app_is_mine(p, d); end if;
    return true;
  end if;
  return true;
end $$;

create or replace function app_can_write(p uuid, c text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p);
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if r = 'labour' then
    if c in ('snags', 'subtasks', 'checklists', 'attendance') then return app_is_my_person(p, d); end if;
    return c in ('audit', 'people', 'peopleDocs');
  end if;
  if c in ('contracts', 'contractText', 'members', 'config', 'parties', 'budget', 'materialsMoney', 'waterMoney', 'risksMoney', 'peopleMoney', 'reports') then return false; end if;
  if c in ('pettycash', 'grnsMoney') then return r in ('owner_supervisor', 'site_supervisor', 'store_keeper'); end if;
  if c in ('payments', 'changes', 'selections', 'changesMoney', 'selectionsMoney', 'posMoney', 'quotes') then return r in ('builder', 'consultant', 'supplier') and app_is_mine(p, d); end if;
  return true;
end $$;

alter policy app_records_delete on app_records using (app_role(project_id) = 'owner');

revoke all on function app_is_my_person(uuid, jsonb) from public, anon;
grant execute on function app_is_my_person(uuid, jsonb) to authenticated;

-- move existing amounts of change orders and selections into their own records
insert into app_records (project_id, col, id, data)
select project_id, 'changesMoney', id, jsonb_strip_nulls(jsonb_build_object('cost', data->'cost', 'partyId', data->'partyId', 'supplierId', data->'supplierId'))
from app_records where col = 'changes' and data ? 'cost'
on conflict (project_id, col, id) do update set data = app_records.data || excluded.data;
update app_records set data = data - 'cost' where col = 'changes' and data ? 'cost';
insert into app_records (project_id, col, id, data)
select project_id, 'selectionsMoney', id, jsonb_strip_nulls(jsonb_build_object('allowance', data->'allowance', 'chosenPrice', data->'chosenPrice', 'options', data->'options', 'partyId', data->'partyId', 'supplierId', data->'supplierId'))
from app_records where col = 'selections' and (data ? 'allowance' or data ? 'chosenPrice' or data ? 'options')
on conflict (project_id, col, id) do update set data = app_records.data || excluded.data;
update app_records set data = data - 'allowance' - 'chosenPrice' - 'options' where col = 'selections';
