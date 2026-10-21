-- Sign in with the site card: the card carries a secret, the person adds a PIN.
create table if not exists public.card_logins (
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  secret text not null,
  pin_hash text not null,
  pin_salt text not null,
  enabled boolean not null default true,
  failed_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid,
  updated_at timestamptz not null default now(),
  primary key (project_id, person_id)
);
create unique index if not exists card_logins_secret on public.card_logins(secret);
alter table public.card_logins enable row level security;
revoke all on public.card_logins from anon, authenticated;
create table if not exists public.card_login_log (
  id bigserial primary key, at timestamptz not null default now(),
  project_id uuid, person_id text, ok boolean, reason text, ip text
);
alter table public.card_login_log enable row level security;
revoke all on public.card_login_log from anon, authenticated;
