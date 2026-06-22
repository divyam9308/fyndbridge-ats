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
