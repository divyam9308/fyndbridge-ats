-- PDF version labels are permanent audit identifiers. Deleting an older
-- version must not renumber the remaining rows, and a deleted number must not
-- be reused by a later regeneration.

alter table public.invoices
  add column if not exists pdf_version_counter integer not null default 0;

alter table public.invoice_pdf_versions
  add column if not exists version_number integer;

-- Preserve the current chronological meaning when assigning numbers to
-- versions that existed before this migration.
with ranked_versions as (
  select
    version.id,
    row_number() over (
      partition by version.invoice_id
      order by version.created_at, version.id
    )::integer as version_number
  from public.invoice_pdf_versions version
)
update public.invoice_pdf_versions version
set version_number = ranked.version_number
from ranked_versions ranked
where version.id = ranked.id
  and version.version_number is null;

alter table public.invoice_pdf_versions
  alter column version_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'invoices_pdf_version_counter_nonnegative'
      and conrelid = 'public.invoices'::pg_catalog.regclass
  ) then
    alter table public.invoices
      add constraint invoices_pdf_version_counter_nonnegative
      check (pdf_version_counter >= 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'invoice_pdf_versions_version_number_positive'
      and conrelid = 'public.invoice_pdf_versions'::pg_catalog.regclass
  ) then
    alter table public.invoice_pdf_versions
      add constraint invoice_pdf_versions_version_number_positive
      check (version_number > 0);
  end if;
end
$$;

create unique index if not exists invoice_pdf_versions_invoice_id_version_number_key
  on public.invoice_pdf_versions (invoice_id, version_number);

-- The counter remains at the highest number ever allocated. It is incremented
-- when a new version is created and is intentionally not decremented on delete.
with highest_versions as (
  select
    version.invoice_id,
    max(version.version_number) as version_number
  from public.invoice_pdf_versions version
  group by version.invoice_id
)
update public.invoices invoice
set pdf_version_counter = pg_catalog.greatest(
  invoice.pdf_version_counter,
  highest.version_number
)
from highest_versions highest
where invoice.id = highest.invoice_id;

create or replace function public.preserve_invoice_pdf_version_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.invoice_id is distinct from old.invoice_id
    or new.version_number is distinct from old.version_number then
    raise exception using
      errcode = 'P0001',
      message = 'IMMUTABLE_INVOICE_PDF_VERSION';
  end if;

  return new;
end;
$$;

drop trigger if exists preserve_invoice_pdf_version_number
  on public.invoice_pdf_versions;

create trigger preserve_invoice_pdf_version_number
before update of invoice_id, version_number
on public.invoice_pdf_versions
for each row
execute function public.preserve_invoice_pdf_version_number();

create or replace function public.create_invoice_pdf_version(
  p_invoice_id uuid,
  p_storage_path text
)
returns public.invoice_pdf_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version_number integer;
  v_version public.invoice_pdf_versions;
begin
  if nullif(pg_catalog.btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'INVALID_INVOICE_STORAGE_PATH';
  end if;

  -- Updating the parent row takes a short row lock, making allocation atomic
  -- even when two regenerations are saved concurrently.
  update public.invoices
  set pdf_version_counter = pdf_version_counter + 1
  where id = p_invoice_id
  returning pdf_version_counter into v_version_number;

  if v_version_number is null then
    raise exception using
      errcode = 'P0002',
      message = 'INVOICE_NOT_FOUND';
  end if;

  insert into public.invoice_pdf_versions (
    invoice_id,
    storage_path,
    version_number
  )
  values (
    p_invoice_id,
    pg_catalog.btrim(p_storage_path),
    v_version_number
  )
  returning * into v_version;

  return v_version;
end;
$$;

create or replace function public.attach_invoice_pdf(
  p_invoice_id uuid,
  p_storage_path text
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  perform public.create_invoice_pdf_version(p_invoice_id, p_storage_path);

  update public.invoices
  set pdf_storage_path = pg_catalog.btrim(p_storage_path)
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.preserve_invoice_pdf_version_number()
  from public, anon, authenticated;
revoke all on function public.create_invoice_pdf_version(uuid, text)
  from public, anon, authenticated;
revoke all on function public.attach_invoice_pdf(uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_invoice_pdf_version(uuid, text)
  to service_role;
grant execute on function public.attach_invoice_pdf(uuid, text)
  to service_role;
