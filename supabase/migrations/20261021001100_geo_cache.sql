-- cached addresses for GPS points (server only)
create table if not exists public.geo_cache (key text primary key, address text not null, at timestamptz not null default now());
alter table public.geo_cache enable row level security;
revoke all on public.geo_cache from anon, authenticated;
