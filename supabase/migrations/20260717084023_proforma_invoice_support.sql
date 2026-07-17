alter table public.invoices
  add column if not exists invoice_type text;

update public.invoices
set invoice_type = 'tax_invoice'
where invoice_type is null or btrim(invoice_type) = '';

alter table public.invoices
  alter column invoice_type set default 'tax_invoice',
  alter column invoice_type set not null;

alter table public.invoices
  drop constraint if exists invoices_invoice_type_check;

alter table public.invoices
  add constraint invoices_invoice_type_check
  check (invoice_type in ('tax_invoice', 'proforma_invoice'));

alter table public.invoices
  drop constraint if exists invoices_billing_entity_financial_year_sequence_number_key;

alter table public.invoices
  drop constraint if exists invoices_type_billing_entity_financial_year_sequence_key;

alter table public.invoices
  add constraint invoices_type_billing_entity_financial_year_sequence_key
  unique (invoice_type, billing_entity, financial_year, sequence_number);

drop index if exists public.invoices_sequence_idx;

create index invoices_sequence_idx
  on public.invoices (invoice_type, billing_entity, financial_year, sequence_number);

create index if not exists invoices_entity_type_status_created_at_idx
  on public.invoices (invoice_entity_id, invoice_type, status, created_at desc);

create index if not exists invoices_type_financial_year_status_created_at_idx
  on public.invoices (invoice_type, financial_year, status, created_at desc);

create or replace function public.next_typed_invoice_sequence(
  p_billing_entity text,
  p_financial_year text,
  p_invoice_type text
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select candidate.sequence_number
  from generate_series(
    1,
    coalesce((
      select max(invoice.sequence_number)
      from public.invoices invoice
      where invoice.billing_entity = p_billing_entity
        and invoice.financial_year = p_financial_year
        and invoice.invoice_type = p_invoice_type
    ), 0) + 1
  ) as candidate(sequence_number)
  where not exists (
    select 1
    from public.invoices invoice
    where invoice.billing_entity = p_billing_entity
      and invoice.financial_year = p_financial_year
      and invoice.invoice_type = p_invoice_type
      and invoice.sequence_number = candidate.sequence_number
  )
  order by candidate.sequence_number
  limit 1;
$$;

-- Keep the established two-argument helper as a tax-invoice compatibility
-- wrapper so older server deployments retain their exact numbering behavior.
create or replace function public.next_invoice_sequence(
  p_billing_entity text,
  p_financial_year text
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select public.next_typed_invoice_sequence(
    p_billing_entity,
    p_financial_year,
    'tax_invoice'
  );
$$;

create or replace function public.next_available_invoice_number_by_type(
  p_billing_entity text,
  p_financial_year text,
  p_invoice_type text
)
returns table (
  financial_year text,
  sequence_number integer,
  invoice_number text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_sequence integer;
  v_prefix text;
begin
  if p_billing_entity not in ('FCS', 'FCAPL') then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_BILLING_ENTITY';
  end if;
  if coalesce(p_financial_year, '') !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_FINANCIAL_YEAR';
  end if;
  if p_invoice_type not in ('tax_invoice', 'proforma_invoice') then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_TYPE';
  end if;

  v_sequence := public.next_typed_invoice_sequence(
    p_billing_entity,
    p_financial_year,
    p_invoice_type
  );
  v_prefix := case
    when p_invoice_type = 'proforma_invoice' then 'PI/' || p_billing_entity
    when p_billing_entity = 'FCAPL' then 'FCAPL'
    else 'FB'
  end;

  return query
  select
    p_financial_year,
    v_sequence,
    v_prefix || '/' || p_financial_year || '/' ||
      case
        when length(v_sequence::text) < 3 then lpad(v_sequence::text, 3, '0')
        else v_sequence::text
      end;
end;
$$;

-- Preserve the original public RPC signature for tax-invoice clients.
create or replace function public.next_available_invoice_number(
  p_billing_entity text,
  p_financial_year text
)
returns table (
  financial_year text,
  sequence_number integer,
  invoice_number text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.next_available_invoice_number_by_type(
    p_billing_entity,
    p_financial_year,
    'tax_invoice'
  );
$$;

create or replace function public.create_invoice_with_lowest_sequence(
  p_invoice jsonb,
  p_expected_invoice_number text
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_billing_entity text := p_invoice ->> 'billing_entity';
  v_financial_year text := p_invoice ->> 'financial_year';
  v_invoice_type text := coalesce(nullif(p_invoice ->> 'invoice_type', ''), 'tax_invoice');
  v_sequence integer;
  v_prefix text;
  v_invoice_number text;
  v_invoice public.invoices;
begin
  if v_billing_entity not in ('FCS', 'FCAPL') then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_BILLING_ENTITY';
  end if;
  if coalesce(v_financial_year, '') !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_FINANCIAL_YEAR';
  end if;
  if v_invoice_type not in ('tax_invoice', 'proforma_invoice') then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_TYPE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('invoice-number'),
    pg_catalog.hashtext(v_invoice_type || ':' || v_billing_entity || ':' || v_financial_year)
  );

  v_sequence := public.next_typed_invoice_sequence(
    v_billing_entity,
    v_financial_year,
    v_invoice_type
  );
  v_prefix := case
    when v_invoice_type = 'proforma_invoice' then 'PI/' || v_billing_entity
    when v_billing_entity = 'FCAPL' then 'FCAPL'
    else 'FB'
  end;
  v_invoice_number := v_prefix || '/' || v_financial_year || '/' ||
    case
      when length(v_sequence::text) < 3 then lpad(v_sequence::text, 3, '0')
      else v_sequence::text
    end;

  if nullif(btrim(coalesce(p_expected_invoice_number, '')), '') is not null
    and btrim(p_expected_invoice_number) <> v_invoice_number then
    raise exception using errcode = 'P0001', message = 'INVOICE_NUMBER_CHANGED';
  end if;

  insert into public.invoices (
    invoice_entity_id,
    invoice_type,
    invoice_display_id,
    invoice_number,
    financial_year,
    sequence_number,
    invoice_date,
    consultant_name,
    candidate_name,
    professional_fee_text,
    model,
    ctc_lpa,
    model_percent,
    model_flat_fee,
    retainer_amount,
    project_amount,
    jra_adjustment_value,
    jra_base_value,
    jra_flat_fee,
    others_amount,
    sac,
    billing_entity,
    taxable_amount,
    gst_component,
    igst_rate,
    igst_amount,
    cgst_rate,
    cgst_amount,
    sgst_rate,
    sgst_amount,
    total_tax_amount,
    total_before_rounding,
    rounding_type,
    rounding_amount,
    grand_total,
    amount_in_words,
    tax_amount_in_words,
    pdf_storage_path,
    status,
    cancelled_at,
    cancelled_by
  )
  values (
    (p_invoice ->> 'invoice_entity_id')::uuid,
    v_invoice_type,
    nullif(p_invoice ->> 'invoice_display_id', ''),
    v_invoice_number,
    v_financial_year,
    v_sequence,
    (p_invoice ->> 'invoice_date')::date,
    nullif(p_invoice ->> 'consultant_name', ''),
    nullif(p_invoice ->> 'candidate_name', ''),
    coalesce(p_invoice ->> 'professional_fee_text', ''),
    p_invoice ->> 'model',
    nullif(p_invoice ->> 'ctc_lpa', '')::numeric,
    nullif(p_invoice ->> 'model_percent', '')::numeric,
    nullif(p_invoice ->> 'model_flat_fee', '')::numeric,
    nullif(p_invoice ->> 'retainer_amount', '')::numeric,
    nullif(p_invoice ->> 'project_amount', '')::numeric,
    nullif(p_invoice ->> 'jra_adjustment_value', '')::numeric,
    nullif(p_invoice ->> 'jra_base_value', '')::numeric,
    nullif(p_invoice ->> 'jra_flat_fee', '')::numeric,
    nullif(p_invoice ->> 'others_amount', '')::numeric,
    coalesce(nullif(p_invoice ->> 'sac', ''), '998512'),
    v_billing_entity,
    (p_invoice ->> 'taxable_amount')::numeric,
    p_invoice ->> 'gst_component',
    nullif(p_invoice ->> 'igst_rate', '')::numeric,
    nullif(p_invoice ->> 'igst_amount', '')::numeric,
    nullif(p_invoice ->> 'cgst_rate', '')::numeric,
    nullif(p_invoice ->> 'cgst_amount', '')::numeric,
    nullif(p_invoice ->> 'sgst_rate', '')::numeric,
    nullif(p_invoice ->> 'sgst_amount', '')::numeric,
    (p_invoice ->> 'total_tax_amount')::numeric,
    (p_invoice ->> 'total_before_rounding')::numeric,
    nullif(p_invoice ->> 'rounding_type', ''),
    coalesce(nullif(p_invoice ->> 'rounding_amount', '')::numeric, 0),
    (p_invoice ->> 'grand_total')::numeric,
    p_invoice ->> 'amount_in_words',
    p_invoice ->> 'tax_amount_in_words',
    null,
    'active',
    null,
    null
  )
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.next_typed_invoice_sequence(text, text, text) from public, anon, authenticated;
revoke all on function public.next_invoice_sequence(text, text) from public, anon, authenticated;
revoke all on function public.next_available_invoice_number_by_type(text, text, text) from public, anon, authenticated;
revoke all on function public.next_available_invoice_number(text, text) from public, anon, authenticated;
revoke all on function public.create_invoice_with_lowest_sequence(jsonb, text) from public, anon, authenticated;

grant execute on function public.next_typed_invoice_sequence(text, text, text) to service_role;
grant execute on function public.next_invoice_sequence(text, text) to service_role;
grant execute on function public.next_available_invoice_number_by_type(text, text, text) to service_role;
grant execute on function public.next_available_invoice_number(text, text) to service_role;
grant execute on function public.create_invoice_with_lowest_sequence(jsonb, text) to service_role;
