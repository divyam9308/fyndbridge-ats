create table if not exists public.cvs (
  id uuid primary key default gen_random_uuid(),
  temp_id text,
  file_name text not null,
  resume_path text,
  resume_url text,
  candidate_name text,
  phone_number text,
  email text,
  current_designation text,
  current_organization text,
  experience_years numeric,
  warnings text[] not null default '{}',
  parse_error text,
  reviewed boolean not null default false,
  imported boolean not null default false,
  imported_candidate_id uuid references public.candidates(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cvs_candidate_name_idx
  on public.cvs(candidate_name);

create index if not exists cvs_phone_number_idx
  on public.cvs(phone_number);

create index if not exists cvs_email_idx
  on public.cvs(email);

create index if not exists cvs_resume_path_idx
  on public.cvs(resume_path);

create index if not exists cvs_reviewed_idx
  on public.cvs(reviewed);

create index if not exists cvs_imported_idx
  on public.cvs(imported);

create index if not exists cvs_created_at_idx
  on public.cvs(created_at desc);

alter table public.cvs
  drop column if exists serial_no;
