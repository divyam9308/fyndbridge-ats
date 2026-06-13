create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique not null,
  name text,
  email text,
  gender text,
  blood_group text,
  pan text,
  emergency_mobile_number text,
  mobile_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_email_idx
  on public.user_profiles(email);

