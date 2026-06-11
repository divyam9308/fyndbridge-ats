alter table public.candidates
  add column if not exists skills text[] not null default '{}';
