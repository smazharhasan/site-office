-- Procurement with versions: PO documents ("podocs") follow the purchase-order access rules,
-- and confirmed quotations, locked RFQs and locked PO documents can't be edited by anyone
-- (a change means a new version); only their status may move on.

create or replace function app_rec_key(c text) returns text language sql immutable as $$
  select case
    when c in ('selections') then 'changes'
    when c in ('contractText') then 'contracts'
    when c in ('tank') then 'water'
    when c in ('peopleDocs') then 'people'
    when c in ('config', 'reports') then 'settings'
    when c in ('invoices', 'workorders', 'podocs') then 'pos'
    when c = 'changesMoney' then 'changes' when c = 'selectionsMoney' then 'changes' when c in ('posMoney', 'podocsMoney') then 'pos'
    when c = 'materialsMoney' then 'materials' when c = 'grnsMoney' then 'grns' when c = 'waterMoney' then 'water'
    when c = 'peopleMoney' then 'people' when c = 'risksMoney' then 'risks'
    when c in ('milestones','stages','subtasks','payments','budget','changes','contracts','pettycash','suppliers','materials','rfqs','quotes','pos','dns','grns','returns','issues','counts','water','inspections','checklists','snags','drawings','risks','logs','attendance','camera','people','members','audits') then c
    else null end $$;

create or replace function app_money_key(c text) returns text language sql immutable as $$
  select case c
    when 'budget' then 'budget' when 'contracts' then 'contractValue' when 'contractText' then 'contractValue'
    when 'payments' then 'payments' when 'changesMoney' then 'changeCost' when 'selectionsMoney' then 'selections'
    when 'quotes' then 'quotes' when 'posMoney' then 'poPrices' when 'materialsMoney' then 'matRates'
    when 'grnsMoney' then 'grnBill' when 'pettycash' then 'pettycash' when 'waterMoney' then 'water'
    when 'peopleMoney' then 'wages' when 'risksMoney' then 'riskCost'
    when 'invoices' then 'poPrices' when 'workorders' then 'poPrices' when 'podocs' then 'poPrices' when 'podocsMoney' then 'poPrices' else null end $$;

create or replace function app_doc_lock() returns trigger language plpgsql security definer set search_path = public as $$
declare locked boolean := false; keep text[];
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then return new; end if;
  if old.col = 'quotes' and coalesce(old.data->>'status', '') in ('Confirmed', 'Locked', 'Superseded') and coalesce(old.data->>'v', '') = '2' then
    locked := true; keep := array['status', 'lockedAt', 'lockedBy', 'poDocId', 'poGroup', 'supersededBy', 'contractRequested', 'updatedAt', 'updatedBy'];
  elsif old.col = 'podocs' and coalesce(old.data->>'status', '') in ('Locked', 'Superseded', 'Completed', 'Cancelled') then
    locked := true; keep := array['status', 'contractRequested', 'closedAt', 'cancelledAt', 'cancelReason', 'sentLog', 'updatedAt', 'updatedBy'];
  elsif old.col = 'podocsMoney' and exists (select 1 from app_records r where r.project_id = old.project_id and r.col = 'podocs' and r.id = old.id and coalesce(r.data->>'status', '') in ('Locked', 'Superseded', 'Completed', 'Cancelled')) then
    locked := true; keep := array['updatedAt', 'updatedBy', 'partyId', 'supplierId'];
  elsif old.col = 'rfqs' and coalesce(old.data->>'locked', '') = 'true' then
    locked := true; keep := array['status', 'sentLog', 'closedAt', 'updatedAt', 'updatedBy'];
  end if;
  if not locked then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'A confirmed or locked document can''t be deleted' using errcode = '42501'; end if;
  -- a locked document's status only moves forward
  if old.col = 'quotes' and coalesce(new.data->>'status', '') not in ('Confirmed', 'Locked', 'Superseded', 'Rejected')
     or old.col = 'quotes' and old.data->>'status' in ('Locked', 'Superseded') and new.data->>'status' is distinct from old.data->>'status'
     or old.col = 'podocs' and coalesce(new.data->>'status', '') not in ('Locked', 'Superseded', 'Completed', 'Cancelled') then
    raise exception 'This document is confirmed or locked and can''t be edited. Make a new version instead.' using errcode = '42501';
  end if;
  if (old.data - keep) is distinct from (new.data - keep) then
    raise exception 'This document is confirmed or locked and can''t be edited. Make a new version instead.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists app_doc_lock on app_records;
create trigger app_doc_lock before update or delete on app_records for each row execute function app_doc_lock();
