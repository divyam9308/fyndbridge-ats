alter table public.clients
  add column if not exists consultant_name text,
  add column if not exists consultant_user_id uuid;

create index if not exists clients_consultant_name_idx
  on public.clients(consultant_name);

create index if not exists clients_consultant_user_id_idx
  on public.clients(consultant_user_id);
