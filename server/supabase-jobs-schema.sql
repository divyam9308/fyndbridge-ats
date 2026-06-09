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

create index if not exists jobs_client_id_idx
  on public.jobs(client_id);

create index if not exists jobs_title_idx
  on public.jobs(title);

create index if not exists jobs_status_idx
  on public.jobs(status);

alter table public.candidate_associations
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists candidate_associations_client_id_idx
  on public.candidate_associations(client_id);

create index if not exists candidate_associations_job_id_idx
  on public.candidate_associations(job_id);
