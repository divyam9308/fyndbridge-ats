alter table public.clients
  add column if not exists consultant_name text;

create index if not exists clients_consultant_name_idx
  on public.clients(consultant_name);
