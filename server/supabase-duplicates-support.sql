drop index if exists public.candidates_name_mobile_unique;

alter table public.clients
  drop constraint if exists clients_name_key;

create index if not exists candidates_name_email_duplicate_idx
  on public.candidates (lower(trim(full_name)), lower(trim(email)));

create index if not exists clients_name_email_duplicate_idx
  on public.clients (lower(trim(name)), lower(trim(email)));

create index if not exists cvs_name_email_duplicate_idx
  on public.cvs (lower(trim(candidate_name)), lower(trim(email)));
