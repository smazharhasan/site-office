-- Nobody signed-out may call anything; signed-in users may call only what the app needs.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function is_member(uuid), has_role(uuid, text[]), is_staff(uuid), my_person(uuid), my_supplier(uuid),
  on_hand(uuid), held_by(uuid, uuid), phase_progress(uuid, text), haversine_m(double precision, double precision, double precision, double precision),
  resolve_badge(uuid, uuid), mark_attendance(uuid, uuid, uuid, uuid, text) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
