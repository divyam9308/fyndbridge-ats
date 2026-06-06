-- Schema update to add clients and jobs tables

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  contact text,
  phone text not null,
  email text,
  city text,
  state text,
  status text not null default 'Active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  city text,
  state text,
  status text not null default 'Open',
  salary_min integer,
  salary_max integer,
  experience_label text,
  experience_min integer,
  completion integer not null default 0,
  success_count integer not null default 0,
  rejected_by_client integer not null default 0,
  open_positions integer not null default 1,
  skills text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index optimization
create index if not exists clients_name_idx on public.clients(name);
create index if not exists jobs_client_id_idx on public.jobs(client_id);
create index if not exists jobs_title_idx on public.jobs(title);
create index if not exists jobs_status_idx on public.jobs(status);

-- Modify candidate_associations to add optional client_id and job_id foreign keys for mapping
alter table public.candidate_associations
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists candidate_associations_client_id_idx on public.candidate_associations(client_id);
create index if not exists candidate_associations_job_id_idx on public.candidate_associations(job_id);
