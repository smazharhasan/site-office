-- Fraud guards and a change log, enforced on the server whatever the app does.
-- 1. Money and stock records that are approved, issued or paid are locked: only the owner can change them.
-- 2. Approving a PO or invoice and marking a payment paid need the "Full + approve" money right (or the owner).
-- 3. Quantities on stock movements and goods received can't be changed after they are recorded (except by the owner).
-- 4. Only the owner deletes money and stock records.
-- 5. Every insert, change and delete is written to app_changes, readable only by the owner.

create table if not exists app_changes (
  id bigserial primary key,
  project_id uuid not null,            -- no foreign key: the log must survive, and must not block deleting a project
  col text not null,
  rec_id text not null,
  op text not null,
  by_user uuid,
  at timestamptz not null default now(),
  changes jsonb not null default '{}'::jsonb
);
create index if not exists app_changes_project on app_changes(project_id, at desc);
alter table app_changes enable row level security;
revoke all on app_changes from anon, authenticated;
grant select on app_changes to authenticated;
drop policy if exists app_changes_owner on app_changes;
create policy app_changes_owner on app_changes for select to authenticated using (app_role(project_id) = 'owner');

create or replace function app_slim(v jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' and left(v #>> '{}', 5) = 'data:' then '"[photo]"'::jsonb
              when jsonb_typeof(v) in ('object', 'array') and length(v::text) > 2000 then '"[long value]"'::jsonb
              else v end $$;

create or replace function app_log_change() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb := '{}'::jsonb; k text; o jsonb; n jsonb;
begin
  if (case when tg_op = 'DELETE' then old.col else new.col end) in ('audit', 'aiwatch') then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    select coalesce(jsonb_object_agg(e.key, app_slim(e.value)), '{}'::jsonb) into d from jsonb_each(new.data) e where e.key not in ('updatedAt', 'createdAt');
    insert into app_changes(project_id, col, rec_id, op, by_user, changes) values (new.project_id, new.col, new.id, 'insert', auth.uid(), d);
    return new;
  elsif tg_op = 'UPDATE' then
    for k in select distinct x from (select jsonb_object_keys(new.data) x union select jsonb_object_keys(old.data)) s loop
      if k in ('updatedAt', 'createdAt') then continue; end if;
      o := old.data -> k; n := new.data -> k;
      if o is distinct from n then d := d || jsonb_build_object(k, jsonb_build_object('from', app_slim(o), 'to', app_slim(n))); end if;
    end loop;
    if d <> '{}'::jsonb then insert into app_changes(project_id, col, rec_id, op, by_user, changes) values (new.project_id, new.col, new.id, 'update', auth.uid(), d); end if;
    return new;
  else
    select coalesce(jsonb_object_agg(e.key, app_slim(e.value)), '{}'::jsonb) into d from jsonb_each(old.data) e where e.key not in ('updatedAt', 'createdAt');
    insert into app_changes(project_id, col, rec_id, op, by_user, changes) values (old.project_id, old.col, old.id, 'delete', auth.uid(), d);
    return old;
  end if;
end $$;
drop trigger if exists app_log_change on app_records;
create trigger app_log_change after insert or update or delete on app_records for each row execute function app_log_change();

create or replace function app_can_approve(p uuid, money_key text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text := app_role(p); prof jsonb;
begin
  if r = 'owner' then return true; end if;
  prof := app_profile(p); if prof is null then return false; end if;
  return app_money_level(prof->'money'->>money_key) >= 6;
end $$;

create or replace function app_money_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text; c text; p uuid;
  os text; ns text; changed boolean;
begin
  if tg_op = 'DELETE' then c := old.col; p := old.project_id; else c := new.col; p := new.project_id; end if;
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;            -- server functions (AI checks, translations)
  r := app_role(p);
  if r = 'owner' then return case when tg_op = 'DELETE' then old else new end; end if;
  if c not in ('payments', 'pos', 'invoices', 'grns', 'issues', 'pettycash', 'contracts', 'quotes', 'workorders', 'dns', 'returns', 'counts', 'budget') then return case when tg_op = 'DELETE' then old else new end; end if;

  if tg_op = 'DELETE' then
    raise exception 'Only the owner can delete money and stock records' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then os := coalesce(old.data->>'status', ''); else os := ''; end if; ns := coalesce(new.data->>'status', '');

  if c = 'payments' then
    if tg_op = 'UPDATE' and os = 'Paid' then raise exception 'This payment is paid and locked. Only the owner can change it.' using errcode = '42501'; end if;
    if ns = 'Paid' and (tg_op = 'INSERT' or os <> 'Paid') and not app_can_approve(p, 'payments') then
      raise exception 'Only the owner (or someone with approval rights) can mark a payment paid' using errcode = '42501'; end if;
  elsif c = 'pos' then
    if ns in ('Approved', 'Issued') and (tg_op = 'INSERT' or os not in ('Approved', 'Issued', 'Delivered', 'Closed')) and not app_can_approve(p, 'poPrices') then
      raise exception 'Only the owner (or someone with approval rights) can approve a purchase order' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and os in ('Approved', 'Issued', 'Delivered', 'Closed') then
      changed := (old.data->'qty') is distinct from (new.data->'qty') or (old.data->'unitPrice') is distinct from (new.data->'unitPrice')
        or (old.data->'supplierId') is distinct from (new.data->'supplierId') or (old.data->'materialId') is distinct from (new.data->'materialId');
      if changed then raise exception 'An approved purchase order is locked: its supplier, item, quantity and price can''t be changed' using errcode = '42501'; end if;
      if (old.data->>'payStatus') is distinct from (new.data->>'payStatus') and not app_can_approve(p, 'poPrices') then
        raise exception 'Only the owner can change the payment status of a purchase order' using errcode = '42501'; end if;
    end if;
  elsif c = 'invoices' then
    if tg_op = 'UPDATE' and os = 'Paid' then raise exception 'This invoice is paid and locked' using errcode = '42501'; end if;
    if ns in ('Approved', 'Paid') and (tg_op = 'INSERT' or os <> ns) and not app_can_approve(p, 'poPrices') then
      raise exception 'Only the owner (or someone with approval rights) can approve or pay an invoice' using errcode = '42501'; end if;
  elsif c in ('grns', 'issues', 'returns', 'dns') then
    if tg_op = 'UPDATE' and ((old.data->'qty') is distinct from (new.data->'qty') or (old.data->'qtyAccepted') is distinct from (new.data->'qtyAccepted')
        or (old.data->'qtyReceived') is distinct from (new.data->'qtyReceived') or (old.data->'materialId') is distinct from (new.data->'materialId')) then
      raise exception 'Recorded quantities can''t be changed. Ask the owner to correct it.' using errcode = '42501'; end if;
  elsif c = 'pettycash' then
    if tg_op = 'UPDATE' and os in ('Approved', 'Rejected') then raise exception 'This petty cash entry has been checked by the owner and is locked' using errcode = '42501'; end if;
    if ns in ('Approved', 'Rejected') and (tg_op = 'INSERT' or os <> ns) then raise exception 'Only the owner approves petty cash' using errcode = '42501'; end if;
  elsif c = 'contracts' then
    if tg_op = 'UPDATE' and os in ('Signed', 'Active', 'Completed') and (old.data->'value') is distinct from (new.data->'value') then
      raise exception 'The value of a signed contract can only be changed by the owner' using errcode = '42501'; end if;
  elsif c = 'budget' then
    if tg_op = 'UPDATE' and (old.data->'budget') is distinct from (new.data->'budget') then
      raise exception 'Only the owner changes budget amounts' using errcode = '42501'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists app_money_guard on app_records;
create trigger app_money_guard before insert or update or delete on app_records for each row execute function app_money_guard();

revoke all on function app_can_approve(uuid, text), app_money_guard(), app_log_change(), app_slim(jsonb) from public, anon;
