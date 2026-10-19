-- Private buckets. Phones upload photos to evidence/<project_id>/<user_id>/<uuid>.jpg;
-- the ingest-evidence function then verifies the file and writes the evidence row.
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false), ('contracts', 'contracts', false)
on conflict (id) do nothing;

create policy evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and is_member(((storage.foldername(name))[1])::uuid) and (storage.foldername(name))[2] = auth.uid()::text);
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and is_member(((storage.foldername(name))[1])::uuid) and not has_role(((storage.foldername(name))[1])::uuid, array['supplier']));
create policy contracts_owner_rw on storage.objects for all to authenticated
  using (bucket_id = 'contracts' and has_role(((storage.foldername(name))[1])::uuid, array['owner']))
  with check (bucket_id = 'contracts' and has_role(((storage.foldername(name))[1])::uuid, array['owner']));
