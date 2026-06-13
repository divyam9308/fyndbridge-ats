alter table public.candidate_associations
  add column if not exists billing_entity text;

