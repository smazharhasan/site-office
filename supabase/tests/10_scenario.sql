-- End-to-end rule tests. Run after the migrations on a scratch database:
--   psql -d scratch -f tests/00_local_stubs.sql -f migrations/*.sql -f tests/10_scenario.sql
-- Each check prints PASS or FAIL.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.ok(name text, cond boolean) returns void language plpgsql as $$
begin raise notice '%  %', case when cond then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.expect_error(name text, stmt text, pattern text) returns void language plpgsql as $$
begin
  begin execute stmt; raise notice 'FAIL  % (no error)', name;
  exception when others then
    if sqlerrm ~* pattern then raise notice 'PASS  % -> %', name, sqlerrm; else raise notice 'FAIL  % -> %', name, sqlerrm; end if;
  end;
end $$;

-- owner A creates the organisation, project and people
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into organizations (name, kind) values ('Owner household', 'client');
insert into ids select 'org', id from organizations limit 1;
insert into projects (org_id, name, site_lat, site_lng, site_radius_m) select v, 'Villa 31', 24.9585, 67.3034, 300 from ids where k = 'org';
insert into ids select 'prj', id from projects limit 1;
select pg_temp.ok('creator became owner', app_role((select v from ids where k='prj')) = 'owner');

insert into people (project_id, user_id, full_name, cnic, type, status) select v, '00000000-0000-0000-0000-00000000000a', 'Owner A', '42201-0000001-1', 'owner', 'active' from ids where k='prj';
insert into people (project_id, user_id, full_name, cnic, type, status) select v, '00000000-0000-0000-0000-00000000000b', 'Keeper K', '42201-0000002-1', 'store_keeper', 'active' from ids where k='prj';
insert into people (project_id, full_name, cnic, type, trade, status, btk_card_no, btk_card_expiry) select v, 'Labour L', '42201-0000003-1', 'labour', 'mason', 'active', 'BTK-1', current_date + 200 from ids where k='prj';
insert into people (project_id, full_name, cnic, type, status) select v, 'Pending P', '42201-0000004-1', 'labour', 'pending' from ids where k='prj';
insert into ids select 'pA', id from people where full_name = 'Owner A';
insert into ids select 'pK', id from people where full_name = 'Keeper K';
insert into ids select 'pL', id from people where full_name = 'Labour L';
insert into ids select 'pP', id from people where full_name = 'Pending P';
update project_members set person_id = (select v from ids where k='pA') where user_id = '00000000-0000-0000-0000-00000000000a';
insert into project_members (project_id, user_id, role, person_id) select (select v from ids where k='prj'), '00000000-0000-0000-0000-00000000000b', 'store_keeper', (select v from ids where k='pK');
insert into project_members (project_id, user_id, role) select (select v from ids where k='prj'), '00000000-0000-0000-0000-00000000000c', 'supplier';
insert into materials (project_id, name, unit, kind) select v, 'Cement OPC', 'bag', 'material' from ids where k='prj';
insert into materials (project_id, name, unit, kind, return_days) select v, 'Hammer drill', 'nos', 'tool', 1 from ids where k='prj';
insert into ids select 'mC', id from materials where name = 'Cement OPC';
insert into ids select 'mD', id from materials where name = 'Hammer drill';

-- store keeper K registers a phone; it is not approved yet
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into devices (project_id, user_id, device_key, model, approved) select v, '00000000-0000-0000-0000-00000000000b', 'android-k-1', 'SM-A546E', true from ids where k='prj';
select pg_temp.ok('device registration forced to unapproved', not (select approved from devices where device_key = 'android-k-1'));
select pg_temp.expect_error('store keeper cannot approve own device', $$update devices set approved = true where device_key = 'android-k-1'$$, 'Only the owner');
select pg_temp.expect_error('store keeper cannot write evidence directly', $$insert into evidence (project_id, storage_path, sha256, purpose, user_id, captured_at) select v, 'x', 'y', 'release', auth.uid(), now() from ids where k='prj'$$, 'row-level security');
update people set status = 'active' where full_name = 'Pending P';

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('store keeper could not activate a pending person', (select status from people where full_name = 'Pending P') = 'pending');
insert into ids select 'badgeL', badge_token from people where full_name = 'Labour L';
update devices set approved = true where device_key = 'android-k-1';
insert into ids select 'dev', id from devices where device_key = 'android-k-1';

-- evidence is written by the ingest function (service role = table owner here)
reset role;
insert into evidence (project_id, storage_path, sha256, purpose, user_id, device_id, captured_at, lat, lng, accuracy_m, mocked)
select (select v from ids where k='prj'), 'e/' || g, md5(g::text), p, '00000000-0000-0000-0000-00000000000b', (select v from ids where k='dev'), now() - c, la, ln, 8, mk
from (values (1, 'receipt_bill', interval '1 minute', 24.9586, 67.3035, false), (2, 'release', interval '1 minute', 24.9586, 67.3035, false),
             (3, 'release', interval '3 hours', 24.9586, 67.3035, false), (4, 'release', interval '1 minute', 24.90, 67.20, false),
             (5, 'release', interval '1 minute', 24.9586, 67.3035, true), (6, 'attendance', interval '1 minute', 24.9586, 67.3035, false),
             (7, 'release', interval '1 minute', 24.9586, 67.3035, false), (8, 'release', interval '1 minute', 24.9586, 67.3035, false)) v(g, p, c, la, ln, mk);
insert into ids select 'e' || substr(storage_path, 3), id from evidence;
select pg_temp.ok('clean evidence has no flags', (select flags = '{}' from evidence where storage_path = 'e/2'));
select pg_temp.ok('old photo flagged', (select 'clock_skew_or_old_photo' = any (flags) from evidence where storage_path = 'e/3'));
select pg_temp.ok('photo 9 km away flagged', (select 'away_from_site' = any (flags) from evidence where storage_path = 'e/4'));
select pg_temp.ok('mock location flagged', (select 'mocked_location' = any (flags) from evidence where storage_path = 'e/5'));

-- K receives cement with a bill scan, then releases
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into grns (project_id, no, material_id, vendor, qty_received, qty_accepted, bill_evidence_id, received_by)
select (select v from ids where k='prj'), 'GRN-001', (select v from ids where k='mC'), 'Local dealer', 100, 100, (select v from ids where k='e1'), (select v from ids where k='pK');
select pg_temp.ok('GRN puts stock on hand', on_hand((select v from ids where k='mC')) = 100);
select pg_temp.expect_error('release with old photo refused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 5, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e3')), 'clock_skew');
select pg_temp.expect_error('release with photo off site refused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 5, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e4')), 'away_from_site');
select pg_temp.expect_error('release with mocked GPS refused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 5, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e5')), 'mocked');
select pg_temp.expect_error('release to pending person refused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 5, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pP'), (select v from ids where k='pA'), (select v from ids where k='e2')), 'pending');
select pg_temp.expect_error('labour cannot authorise', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 5, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pL'), (select v from ids where k='e2')), 'cannot authorise');
select pg_temp.expect_error('release beyond stock refused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 500, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e2')), 'Only 100');
insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) select (select v from ids where k='prj'), (select v from ids where k='mC'), 'release', 10, (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e2');
select pg_temp.ok('valid release recorded with store keeper stamped', (select store_keeper = (select v from ids where k='pK') from stock_moves where kind = 'release'));
select pg_temp.ok('on hand after release', on_hand((select v from ids where k='mC')) = 90);
select pg_temp.expect_error('photo cannot be reused', format($$insert into stock_moves (project_id, material_id, kind, qty, person_id, authorised_by, evidence_id) values (%L, %L, 'release', 1, %L, %L, %L)$$, (select v from ids where k='prj'), (select v from ids where k='mC'), (select v from ids where k='pL'), (select v from ids where k='pA'), (select v from ids where k='e2')), 'already been used');
update stock_moves set qty = 1;
select pg_temp.ok('stock moves are immutable (no rows changed)', (select sum(qty) from stock_moves where kind = 'release') = 10);

-- attendance only through mark_attendance, with the badge token
select pg_temp.ok('attendance marked from badge', (select (mark_attendance((select v from ids where k='prj'), (select v from ids where k='badgeL'), (select v from ids where k='e6'), null, 'in')).status = 'pending'));
select pg_temp.expect_error('unknown badge refused', format($$select mark_attendance(%L, gen_random_uuid(), %L, null, 'out')$$, (select v from ids where k='prj'), (select v from ids where k='e6')), 'Badge not recognised');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error('attendance evidence cannot be edited, even by the owner', $$update attendance set at = now() - interval '1 day'$$, 'cannot be edited');
update attendance set status = 'approved';
select pg_temp.ok('owner can decide the status', (select status from attendance limit 1) = 'approved');
-- self-registration: user D joins as a site supervisor and registers; record stays pending
insert into project_members (project_id, user_id, role) select v, '00000000-0000-0000-0000-00000000000d', 'site_supervisor' from ids where k='prj';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into people (project_id, user_id, full_name, cnic, type, status) select v, '00000000-0000-0000-0000-00000000000d', 'Supervisor D', '42201-0000005-1', 'supervisor', 'active' from ids where k='prj';
select pg_temp.ok('self-registration forced to pending', (select status from people where full_name = 'Supervisor D') = 'pending');
select pg_temp.expect_error('pending user cannot mark attendance', format($$select mark_attendance(%L, %L, %L, null, 'out')$$, (select v from ids where k='prj'), (select v from ids where k='badgeL'), (select v from ids where k='e6')), 'You: status is pending');
delete from project_members where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from project_members where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');

-- supplier sees nothing from the stores
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok('supplier cannot read stock moves', (select count(*) from stock_moves) = 0);
select pg_temp.ok('supplier cannot read evidence', (select count(*) from evidence) = 0);
select pg_temp.ok('supplier cannot read CNICs', (select count(*) from people) = 0);
select pg_temp.ok('directory masks CNIC', (select bool_and(cnic_masked like '%*******%') from people_directory));
insert into suppliers (project_id, name, status) select v, 'New Supplier', 'approved' from ids where k='prj';
select pg_temp.ok('supplier self-registration forced to pending', (select status from suppliers where name = 'New Supplier') = 'pending');

-- outsider sees nothing
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok('outsider cannot see the project', (select count(*) from projects) = 0);
reset role;
select pg_temp.ok('audit trail recorded', (select count(*) from audit_log) > 5);
