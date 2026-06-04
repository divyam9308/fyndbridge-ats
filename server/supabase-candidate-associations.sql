create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
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

alter table public.candidates
  add column if not exists current_organisation text,
  add column if not exists notice_period integer,
  add column if not exists open_to_relocate boolean default false,
  add column if not exists linkedin_url text;
