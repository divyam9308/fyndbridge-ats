create table if not exists invoice_entities (
  id uuid primary key default gen_random_uuid(),
  invoice_id text unique not null,
  legal_entity_name text not null,
  address text not null,
  pan text,
  place_of_supply text,
  state text,
  state_code text,
  gstin text,
  contact_person text,
  email text,
  model text check (model in ('joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others')),
  ctc_lpa numeric,
  model_percent numeric,
  model_flat_fee numeric,
  retainer_amount numeric,
  jra_adjustment_value numeric,
  jra_base_value numeric,
  jra_flat_fee numeric,
  others_amount numeric,
  sac text default '998512',
  billing_entity text not null check (billing_entity in ('FCS', 'FCAPL')),
  gst_component text check (gst_component in ('IGST', 'CGST_SGST')),
  igst_rate numeric default 18,
  cgst_rate numeric default 9,
  sgst_rate numeric default 9,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_entity_id uuid references invoice_entities(id) on delete set null,
  billing_entity text not null check (billing_entity in ('FCS', 'FCAPL')),
  invoice_number text unique not null,
  financial_year text not null,
  sequence_number integer not null,
  invoice_date date not null,
  taxable_amount numeric not null,
  gst_component text not null check (gst_component in ('IGST', 'CGST_SGST')),
  igst_rate numeric,
  igst_amount numeric,
  cgst_rate numeric,
  cgst_amount numeric,
  sgst_rate numeric,
  sgst_amount numeric,
  total_tax_amount numeric not null,
  total_before_rounding numeric not null,
  rounding_type text check (rounding_type in ('MORE', 'LESS')),
  rounding_amount numeric default 0,
  grand_total numeric not null,
  amount_in_words text not null,
  tax_amount_in_words text not null,
  pdf_storage_path text,
  created_at timestamptz default now(),
  unique (billing_entity, financial_year, sequence_number)
);

alter table invoice_entities enable row level security;
alter table invoices enable row level security;

alter table invoice_entities drop column if exists professional_fee_text;
alter table invoice_entities add column if not exists model text check (model in ('joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others'));
alter table invoice_entities add column if not exists ctc_lpa numeric;
alter table invoice_entities add column if not exists model_percent numeric;
alter table invoice_entities add column if not exists model_flat_fee numeric;
alter table invoice_entities add column if not exists retainer_amount numeric;
alter table invoice_entities add column if not exists jra_adjustment_value numeric;
alter table invoice_entities add column if not exists jra_base_value numeric;
alter table invoice_entities add column if not exists jra_flat_fee numeric;
alter table invoice_entities add column if not exists others_amount numeric;

alter table invoices add column if not exists professional_fee_text text;
alter table invoices add column if not exists model text check (model in ('joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others'));
alter table invoices add column if not exists ctc_lpa numeric;
alter table invoices add column if not exists model_percent numeric;
alter table invoices add column if not exists model_flat_fee numeric;
alter table invoices add column if not exists retainer_amount numeric;
alter table invoices add column if not exists jra_adjustment_value numeric;
alter table invoices add column if not exists jra_base_value numeric;
alter table invoices add column if not exists jra_flat_fee numeric;
alter table invoices add column if not exists others_amount numeric;
alter table invoices add column if not exists sac text default '998512';

drop policy if exists invoice_entities_authenticated_select on invoice_entities;
drop policy if exists invoice_entities_authenticated_insert on invoice_entities;
drop policy if exists invoice_entities_authenticated_update on invoice_entities;
drop policy if exists invoice_entities_authenticated_delete on invoice_entities;
drop policy if exists invoices_authenticated_select on invoices;
drop policy if exists invoices_authenticated_insert on invoices;
drop policy if exists invoice_entities_admin_all on invoice_entities;
drop policy if exists invoices_admin_all on invoices;

create policy invoice_entities_admin_all on invoice_entities
  for all to authenticated
  using (exists (select 1 from admin_users where user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email')))
  with check (exists (select 1 from admin_users where user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email')));

create policy invoices_admin_all on invoices
  for all to authenticated
  using (exists (select 1 from admin_users where user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email')))
  with check (exists (select 1 from admin_users where user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email')));

grant select, insert, update, delete on invoice_entities to authenticated;
grant select, insert, update, delete on invoices to authenticated;

-- Entity master/invoice history upgrade (safe for existing data).
alter table invoice_entities add column if not exists optional_name text default '-';
alter table invoice_entities add column if not exists entity_display_id text;
alter table invoice_entities alter column legal_entity_name drop not null;
alter table invoice_entities alter column address drop not null;
alter table invoice_entities alter column billing_entity set default 'FCS';

with numbered as (
  select id, row_number() over (order by created_at, id) as number
  from invoice_entities
  where entity_display_id is null or btrim(entity_display_id) = ''
)
update invoice_entities entity
set entity_display_id = 'EID' || numbered.number
from numbered
where entity.id = numbered.id;

create unique index if not exists invoice_entities_entity_display_id_key
  on invoice_entities (entity_display_id) where entity_display_id is not null;

alter table invoices add column if not exists invoice_display_id text;
alter table invoices add column if not exists consultant_name text;
alter table invoices add column if not exists candidate_name text;
alter table invoices add column if not exists project_amount numeric;

-- Preserve the first valid IID and safely reassign null, invalid, or duplicate IDs.
with parsed as (
  select
    id,
    created_at,
    case when invoice_display_id ~* '^IID[0-9]+$'
      then substring(invoice_display_id from '[0-9]+$')::bigint
    end as numeric_id,
    row_number() over (
      partition by case when invoice_display_id ~* '^IID[0-9]+$'
        then substring(invoice_display_id from '[0-9]+$')::bigint
      end
      order by created_at, id
    ) as duplicate_rank
  from invoices
), maximum as (
  select coalesce(max(numeric_id), 0) as max_id from parsed
), replacements as (
  select
    parsed.id,
    row_number() over (order by parsed.created_at, parsed.id) as allocation_number
  from parsed
  where parsed.numeric_id is null or parsed.duplicate_rank > 1
)
update invoices invoice
set invoice_display_id = 'IID' || (maximum.max_id + replacements.allocation_number)
from replacements cross join maximum
where invoice.id = replacements.id;

drop index if exists invoices_invoice_display_id_key;
create unique index invoices_invoice_display_id_key
  on invoices (upper(invoice_display_id)) where invoice_display_id is not null;

create sequence if not exists invoice_display_id_seq start 1;
do $$
declare
  max_id bigint;
  sequence_value bigint;
  sequence_called boolean;
begin
  select coalesce(max(substring(invoice_display_id from '[0-9]+$')::bigint), 0)
    into max_id
  from invoices
  where invoice_display_id ~* '^IID[0-9]+$';

  select last_value, is_called
    into sequence_value, sequence_called
  from invoice_display_id_seq;

  if max_id > 0 or sequence_called then
    perform setval('invoice_display_id_seq', greatest(max_id, sequence_value), true);
  else
    perform setval('invoice_display_id_seq', 1, false);
  end if;
end $$;

create or replace function next_invoice_display_id()
returns text
language sql
security definer
set search_path = public
as $$
  select 'IID' || nextval('invoice_display_id_seq')::text;
$$;

revoke all on function next_invoice_display_id() from public;
grant execute on function next_invoice_display_id() to authenticated, service_role;
create index if not exists invoices_invoice_entity_id_created_at_idx
  on invoices (invoice_entity_id, created_at desc);
