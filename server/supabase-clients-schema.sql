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

alter table public.clients
  drop constraint if exists clients_name_key;

create index if not exists clients_name_idx
  on public.clients(name);
