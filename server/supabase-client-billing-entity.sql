alter table public.clients
  add column if not exists billing_entity text;

