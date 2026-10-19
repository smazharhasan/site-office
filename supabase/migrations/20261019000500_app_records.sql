-- Records for the full Site Office (dashboard, schedule, payments, budget, procurement, quality, snags …).
-- One row per document: (project, collection, id) → JSON. Project members read and write;
-- a few collections are the owner's alone, matching the original app's access rules.
create table if not exists app_records (
  project_id uuid not null references projects(id) on delete cascade,
  col text not null check (col ~ '^[A-Za-z]{1,40}$'),
  id text not null check (length(id) between 1 and 200),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (project_id, col, id)
);
alter table app_records enable row level security;
alter table app_records replica identity full;

create or replace function app_col_owner_read(c text) returns boolean language sql immutable as
$$ select c in ('contracts','contractText') $$;
create or replace function app_col_owner_write(c text) returns boolean language sql immutable as
$$ select c in ('contracts','contractText','members','config','parties') $$;

create policy app_records_read on app_records for select to authenticated
  using (is_member(project_id) and (not app_col_owner_read(col) or has_role(project_id, array['owner'])));
create policy app_records_insert on app_records for insert to authenticated
  with check (is_member(project_id) and (not app_col_owner_write(col) or has_role(project_id, array['owner'])));
create policy app_records_update on app_records for update to authenticated
  using (is_member(project_id) and (not app_col_owner_write(col) or has_role(project_id, array['owner'])))
  with check (is_member(project_id) and (not app_col_owner_write(col) or has_role(project_id, array['owner'])));
create policy app_records_delete on app_records for delete to authenticated
  using (is_member(project_id) and (not app_col_owner_write(col) or has_role(project_id, array['owner'])));

create or replace function app_records_stamp() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger app_records_stamp before insert or update on app_records for each row execute function app_records_stamp();

create index if not exists app_records_project on app_records(project_id, col);
grant select, insert, update, delete on app_records to authenticated;
grant execute on function app_col_owner_read(text), app_col_owner_write(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table app_records';
  end if;
exception when duplicate_object then null; end $$;
