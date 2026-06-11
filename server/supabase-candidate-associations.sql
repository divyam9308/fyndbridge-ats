create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  candidate_display_id text unique,
  full_name text not null,
  email text,
  mobile_number text not null,
  city text,
  state text,
  location text,
  current_designation text,
  current_company text,
  current_organisation text,
  experience_years numeric,
  notice_period integer,
  open_to_relocate boolean not null default false,
  skills text[] not null default '{}',
  education text,
  cv_link text,
  linkedin_url text,
  resume_url text,
  source text default 'manual',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists candidates_name_mobile_unique
  on public.candidates (lower(trim(full_name)), mobile_number);

create table if not exists public.candidate_associations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  consultant_name text,
  client_name text,
  job_title text,
  status text not null default 'Interested',
  current_salary integer,
  expected_salary integer,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidate_associations_candidate_id_idx
  on public.candidate_associations(candidate_id);

create index if not exists candidate_associations_job_title_idx
  on public.candidate_associations(job_title);

create index if not exists candidate_associations_client_name_idx
  on public.candidate_associations(client_name);

create index if not exists candidate_associations_consultant_name_idx
  on public.candidate_associations(consultant_name);

create index if not exists candidates_full_name_idx
  on public.candidates(full_name);

create index if not exists candidates_mobile_number_idx
  on public.candidates(mobile_number);

create index if not exists candidates_city_idx
  on public.candidates(city);

create index if not exists candidates_state_idx
  on public.candidates(state);

create index if not exists candidates_experience_years_idx
  on public.candidates(experience_years);

create index if not exists candidate_associations_status_idx
  on public.candidate_associations(status);

create index if not exists candidate_associations_current_salary_idx
  on public.candidate_associations(current_salary);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (id, email, full_name)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.candidates
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists candidate_display_id text,
  add column if not exists current_organisation text,
  add column if not exists notice_period integer,
  add column if not exists open_to_relocate boolean default false,
  add column if not exists linkedin_url text;

alter table public.candidate_associations
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists consultant_name text;

create index if not exists candidates_client_id_idx
  on public.candidates(client_id);

create index if not exists candidate_associations_client_id_idx
  on public.candidate_associations(client_id);
