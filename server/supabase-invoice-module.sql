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
  professional_fee_text text,
  model text not null check (model in ('joining_percentage', 'joining_flat_fee', 'retainer', 'jra_adjustment_percentage', 'jra_adjustment_flat_fee', 'project', 'others')),
  model_percent numeric,
  model_flat_fee numeric,
  retainer_amount numeric,
  jra_adjustment_value numeric,
  jra_base_value numeric,
  jra_flat_fee numeric,
  others_amount numeric,
  sac text default '998512',
  billing_entity text not null check (billing_entity in ('FCS', 'FCAPL')),
  ctc_lpa numeric,
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

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_entities' and policyname = 'invoice_entities_authenticated_select') then
    create policy invoice_entities_authenticated_select on invoice_entities for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_entities' and policyname = 'invoice_entities_authenticated_insert') then
    create policy invoice_entities_authenticated_insert on invoice_entities for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_entities' and policyname = 'invoice_entities_authenticated_update') then
    create policy invoice_entities_authenticated_update on invoice_entities for update to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_entities' and policyname = 'invoice_entities_authenticated_delete') then
    create policy invoice_entities_authenticated_delete on invoice_entities for delete to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_authenticated_select') then
    create policy invoices_authenticated_select on invoices for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_authenticated_insert') then
    create policy invoices_authenticated_insert on invoices for insert to authenticated with check (true);
  end if;
end $$;

grant select, insert, update, delete on invoice_entities to authenticated;
grant select, insert on invoices to authenticated;
