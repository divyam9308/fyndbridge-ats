-- Reassigning an invoice to another legal entity also moves it to that
-- entity's billing series. The target number is allocated under the same
-- advisory lock used by invoice creation so preview/save races cannot produce
-- duplicate or stale invoice numbers.
create or replace function public.update_invoice_with_reassigned_sequence(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_expected_invoice_number text
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.invoices;
  v_entity_id uuid := (p_invoice ->> 'invoice_entity_id')::uuid;
  v_billing_entity text;
  v_invoice_type text;
  v_invoice_date date := (p_invoice ->> 'invoice_date')::date;
  v_start_year integer;
  v_financial_year text;
  v_sequence_scope text;
  v_sequence integer;
  v_prefix text;
  v_invoice_number text;
  v_invoice public.invoices;
begin
  select invoice.*
  into v_existing
  from public.invoices invoice
  where invoice.id = p_invoice_id
  for update;

  if v_existing.id is null then
    raise exception using errcode = 'P0002', message = 'INVOICE_NOT_FOUND';
  end if;
  if v_existing.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'CANCELLED_INVOICE';
  end if;

  select entity.billing_entity
  into v_billing_entity
  from public.invoice_entities entity
  where entity.id = v_entity_id;

  if v_billing_entity not in ('FCS', 'FCAPL') then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_BILLING_ENTITY';
  end if;
  if v_invoice_date is null then
    raise exception using errcode = '22023', message = 'INVALID_INVOICE_DATE';
  end if;

  v_invoice_type := v_existing.invoice_type;
  v_start_year := extract(year from v_invoice_date)::integer -
    case when extract(month from v_invoice_date)::integer < 4 then 1 else 0 end;
  v_financial_year :=
    pg_catalog.lpad((v_start_year % 100)::text, 2, '0') || '-' ||
    pg_catalog.lpad(((v_start_year + 1) % 100)::text, 2, '0');
  v_sequence_scope := case
    when v_invoice_type = 'proforma_invoice' then 'all-entities'
    else v_billing_entity
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('invoice-number'),
    pg_catalog.hashtext(v_invoice_type || ':' || v_sequence_scope || ':' || v_financial_year)
  );

  if v_existing.financial_year = v_financial_year
    and (
      v_invoice_type = 'proforma_invoice'
      or v_existing.billing_entity = v_billing_entity
    ) then
    v_sequence := v_existing.sequence_number;
  else
    v_sequence := public.next_typed_invoice_sequence(
      v_billing_entity,
      v_financial_year,
      v_invoice_type
    );
  end if;

  v_prefix := case
    when v_invoice_type = 'proforma_invoice' then 'PI/' || v_billing_entity
    when v_billing_entity = 'FCAPL' then 'FCAPL'
    else 'FB'
  end;
  v_invoice_number := v_prefix || '/' || v_financial_year || '/' ||
    case
      when length(v_sequence::text) < 3 then pg_catalog.lpad(v_sequence::text, 3, '0')
      else v_sequence::text
    end;

  if nullif(pg_catalog.btrim(coalesce(p_expected_invoice_number, '')), '') is not null
    and pg_catalog.btrim(p_expected_invoice_number) <> v_invoice_number then
    raise exception using errcode = 'P0001', message = 'INVOICE_NUMBER_CHANGED';
  end if;

  update public.invoices
  set
    invoice_entity_id = v_entity_id,
    invoice_number = v_invoice_number,
    financial_year = v_financial_year,
    sequence_number = v_sequence,
    invoice_date = v_invoice_date,
    consultant_name = nullif(p_invoice ->> 'consultant_name', ''),
    candidate_name = nullif(p_invoice ->> 'candidate_name', ''),
    professional_fee_text = coalesce(p_invoice ->> 'professional_fee_text', ''),
    model = p_invoice ->> 'model',
    ctc_lpa = nullif(p_invoice ->> 'ctc_lpa', '')::numeric,
    model_percent = nullif(p_invoice ->> 'model_percent', '')::numeric,
    model_flat_fee = nullif(p_invoice ->> 'model_flat_fee', '')::numeric,
    retainer_amount = nullif(p_invoice ->> 'retainer_amount', '')::numeric,
    project_amount = nullif(p_invoice ->> 'project_amount', '')::numeric,
    jra_adjustment_value = nullif(p_invoice ->> 'jra_adjustment_value', '')::numeric,
    jra_base_value = nullif(p_invoice ->> 'jra_base_value', '')::numeric,
    jra_flat_fee = nullif(p_invoice ->> 'jra_flat_fee', '')::numeric,
    others_amount = nullif(p_invoice ->> 'others_amount', '')::numeric,
    sac = coalesce(nullif(p_invoice ->> 'sac', ''), '998512'),
    billing_entity = v_billing_entity,
    taxable_amount = (p_invoice ->> 'taxable_amount')::numeric,
    gst_component = p_invoice ->> 'gst_component',
    igst_rate = nullif(p_invoice ->> 'igst_rate', '')::numeric,
    igst_amount = nullif(p_invoice ->> 'igst_amount', '')::numeric,
    cgst_rate = nullif(p_invoice ->> 'cgst_rate', '')::numeric,
    cgst_amount = nullif(p_invoice ->> 'cgst_amount', '')::numeric,
    sgst_rate = nullif(p_invoice ->> 'sgst_rate', '')::numeric,
    sgst_amount = nullif(p_invoice ->> 'sgst_amount', '')::numeric,
    total_tax_amount = (p_invoice ->> 'total_tax_amount')::numeric,
    total_before_rounding = (p_invoice ->> 'total_before_rounding')::numeric,
    rounding_type = nullif(p_invoice ->> 'rounding_type', ''),
    rounding_amount = coalesce(nullif(p_invoice ->> 'rounding_amount', '')::numeric, 0),
    grand_total = (p_invoice ->> 'grand_total')::numeric,
    amount_in_words = p_invoice ->> 'amount_in_words',
    tax_amount_in_words = p_invoice ->> 'tax_amount_in_words',
    pdf_storage_path = nullif(p_invoice ->> 'pdf_storage_path', '')
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.update_invoice_with_reassigned_sequence(uuid, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.update_invoice_with_reassigned_sequence(uuid, jsonb, text)
  to service_role;
