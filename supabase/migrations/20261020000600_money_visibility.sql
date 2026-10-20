-- Who may see money.
--   owner                                   everything
--   builder / consultant / supplier         only their own contract, payments, changes, quotes and PO prices
--   owner's supervisor, site supervisor,    petty cash (and receipt bill amounts they enter) — no budget,
--   store keeper                            contracts, payments, PO prices or quotes
--   labour                                  no money at all
-- Price fields of POs, receipts and materials live in separate "…Money" records so the rest of
-- the record (quantities, dates) stays visible to the people who receive and issue goods.

alter table project_members drop constraint if exists project_members_role_check;
alter table project_members add constraint project_members_role_check
  check (role = any (array['owner','owner_supervisor','builder','site_supervisor','store_keeper','supplier','consultant','labour']));

-- the signed-in person's own member record in the full Site Office (portal, partyId, supplierId)
create or replace function app_member_doc(p uuid) returns jsonb language sql stable security definer set search_path = public as
$$ select data from app_records where project_id = p and col = 'members' and id = auth.uid()::text $$;

create or replace function app_is_mine(p uuid, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare m jsonb := app_member_doc(p);
begin
  if m is null or d is null then return false; end if;
  return (coalesce(m->>'partyId', '') <> '' and d->>'partyId' = m->>'partyId')
      or (coalesce(m->>'supplierId', '') <> '' and d->>'supplierId' = m->>'supplierId');
end $$;

create or replace function app_can_read(p uuid, c text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p);
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if c in ('budget', 'contractText', 'reports', 'materialsMoney', 'waterMoney', 'risksMoney', 'peopleMoney') then return false; end if;
  if c in ('pettycash', 'grnsMoney') then return r in ('owner_supervisor', 'site_supervisor', 'store_keeper'); end if;
  if c in ('payments', 'contracts', 'changes', 'selections', 'posMoney', 'quotes') then
    return r in ('builder', 'consultant', 'supplier') and app_is_mine(p, d);
  end if;
  if c = 'pos' then  -- quantities and dates only (prices are in posMoney)
    if r = 'labour' then return false; end if;
    if r = 'supplier' then return app_is_mine(p, d); end if;
    return true;
  end if;
  if r = 'labour' and c in ('rfqs', 'parties', 'suppliers') then return false; end if;
  return true;
end $$;

create or replace function app_can_write(p uuid, c text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p);
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if c in ('contracts', 'contractText', 'members', 'config', 'parties', 'budget', 'materialsMoney', 'waterMoney', 'risksMoney', 'peopleMoney', 'reports') then return false; end if;
  if c = 'pettycash' then return r in ('owner_supervisor', 'site_supervisor', 'store_keeper'); end if;
  if c = 'grnsMoney' then return r in ('owner_supervisor', 'site_supervisor', 'store_keeper'); end if;
  if c in ('payments', 'changes', 'selections', 'posMoney', 'quotes') then return r in ('builder', 'consultant', 'supplier') and app_is_mine(p, d); end if;
  if r = 'labour' then return c in ('snags', 'subtasks', 'checklists', 'audit', 'people', 'peopleDocs', 'camera'); end if;
  return true;
end $$;

alter policy app_records_read on app_records using (app_can_read(project_id, col, data));
alter policy app_records_insert on app_records with check (app_can_write(project_id, col, data));
alter policy app_records_update on app_records using (app_can_write(project_id, col, data)) with check (app_can_write(project_id, col, data));
alter policy app_records_delete on app_records using (app_can_write(project_id, col, data) and (app_role(project_id) = 'owner' or col in ('logs', 'issues', 'snags', 'pettycash')));

revoke all on function app_member_doc(uuid), app_is_mine(uuid, jsonb), app_can_read(uuid, text, jsonb), app_can_write(uuid, text, jsonb) from public, anon;
grant execute on function app_member_doc(uuid), app_is_mine(uuid, jsonb), app_can_read(uuid, text, jsonb), app_can_write(uuid, text, jsonb) to authenticated;

-- move existing price fields of materials into their own owner-only records
insert into app_records (project_id, col, id, data)
select project_id, 'materialsMoney', id, jsonb_strip_nulls(jsonb_build_object('budgetRate', data->'budgetRate', 'monthlyBudget', data->'monthlyBudget', 'partyId', data->'partyId'))
from app_records where col = 'materials' and (data ? 'budgetRate' or data ? 'monthlyBudget')
on conflict (project_id, col, id) do update set data = app_records.data || excluded.data;
update app_records set data = data - 'budgetRate' - 'monthlyBudget' where col = 'materials' and (data ? 'budgetRate' or data ? 'monthlyBudget');

-- the same split for the other records that carry money
insert into app_records (project_id, col, id, data)
select project_id, m.mcol, r.id, jsonb_strip_nulls(jsonb_build_object(m.k1, r.data->m.k1, m.k2, r.data->m.k2, 'partyId', r.data->'partyId', 'supplierId', r.data->'supplierId'))
from app_records r join (values ('water','waterMoney','cost',null), ('risks','risksMoney','costImpact',null), ('people','peopleMoney','wage',null), ('grns','grnsMoney','rate','amount')) as m(col, mcol, k1, k2) on r.col = m.col
where r.data ? m.k1 or (m.k2 is not null and r.data ? m.k2)
on conflict (project_id, col, id) do update set data = app_records.data || excluded.data;
update app_records set data = data - 'cost' where col = 'water' and data ? 'cost';
update app_records set data = data - 'costImpact' where col = 'risks' and data ? 'costImpact';
update app_records set data = data - 'wage' where col = 'people' and data ? 'wage';
update app_records set data = data - 'rate' - 'amount' where col = 'grns' and (data ? 'rate' or data ? 'amount');
insert into app_records (project_id, col, id, data)
select project_id, 'posMoney', id, jsonb_strip_nulls(jsonb_build_object('unitPrice', data->'unitPrice', 'payProof', data->'payProof', 'paidRef', data->'paidRef', 'payMethod', data->'payMethod', 'paidDate', data->'paidDate', 'partyId', data->'partyId', 'supplierId', data->'supplierId'))
from app_records where col = 'pos' and (data ? 'unitPrice' or data ? 'payProof' or data ? 'paidRef')
on conflict (project_id, col, id) do update set data = app_records.data || excluded.data;
update app_records set data = data - 'unitPrice' - 'payProof' - 'paidRef' - 'payMethod' - 'paidDate' where col = 'pos';

-- field-app tables: quotes only to the owner and the quoting supplier; PO prices only through the owner's records
alter policy quote_read on quotes using (has_role(project_id, array['owner']) or supplier_id = my_supplier(project_id));
