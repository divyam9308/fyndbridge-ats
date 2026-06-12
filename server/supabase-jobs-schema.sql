create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_display_id text unique,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  city text,
  state text,
  consultants text[] not null default '{}',
  team_lead text,
  budget text,
  priority text,
  vertical text,
  allocation_date date,
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

alter table public.jobs
  add column if not exists job_display_id text,
  add column if not exists consultants text[] not null default '{}',
  add column if not exists team_lead text,
  add column if not exists budget text,
  add column if not exists priority text,
  add column if not exists vertical text,
  add column if not exists allocation_date date;

create index if not exists jobs_client_id_idx
  on public.jobs(client_id);

create index if not exists jobs_title_idx
  on public.jobs(title);

create index if not exists jobs_display_id_idx
  on public.jobs(job_display_id);

create index if not exists jobs_priority_idx
  on public.jobs(priority);

create index if not exists jobs_allocation_date_idx
  on public.jobs(allocation_date);

update public.jobs
set allocation_date = coalesce(allocation_date, created_at::date)
where allocation_date is null;

alter table public.candidate_associations
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists candidate_associations_client_id_idx
  on public.candidate_associations(client_id);

create index if not exists candidate_associations_job_id_idx
  on public.candidate_associations(job_id);
