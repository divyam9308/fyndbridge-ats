-- Receipts deliberately outlive public_applications. No applicant PII or CV paths.
create table public.public_application_deletions (
  application_id uuid primary key,
  operation_id uuid not null,
  last_operation_id uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  last_attempt_by uuid references auth.users(id) on delete set null,
  status text not null check (status in ('processing', 'deleted', 'skipped', 'failed')),
  code text,
  cleanup_started_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.public_application_deletions enable row level security;
revoke all on public.public_application_deletions from public, anon, authenticated;
revoke all on public.public_application_deletions from service_role;
grant select, insert, update on public.public_application_deletions to service_role;

create index public_application_deletions_unresolved
  on public.public_application_deletions (updated_at)
  where status in ('processing', 'failed');

comment on table public.public_application_deletions is
  'Server-only durable deletion receipts and retry markers. Application IDs have no cascading FK to staging rows.';
