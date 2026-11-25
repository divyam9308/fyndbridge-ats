-- Only the backend may add automatic credits. Existing partial unique indexes
-- arbitrate duplicates atomically; existing amounts and history are never updated.
create or replace function public.insert_leave_ledger_credit(
  p_user_id uuid,
  p_financial_year text,
  p_entry_type text,
  p_entry_date date,
  p_amount numeric,
  p_description text,
  p_accrual_month date default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_financial_year is null then
    raise exception 'Financial year is required for leave credits.' using errcode = '22023';
  end if;
  if p_entry_type = 'accrual' then
    if p_accrual_month is null then
      raise exception 'Accrual month is required.' using errcode = '22023';
    end if;
    insert into public.leave_ledger(user_id, financial_year, entry_type, entry_date, amount, description, accrual_month)
    values(p_user_id, p_financial_year, 'accrual', p_entry_date, p_amount, p_description, p_accrual_month)
    on conflict (user_id, financial_year, accrual_month) where entry_type = 'accrual' do nothing;
  elsif p_entry_type = 'opening_balance' then
    insert into public.leave_ledger(user_id, financial_year, entry_type, entry_date, amount, description)
    values(p_user_id, p_financial_year, 'opening_balance', p_entry_date, p_amount, p_description)
    on conflict (user_id, financial_year) where entry_type = 'opening_balance' do nothing;
  else
    raise exception 'Only automatic accrual and opening balance credits are supported.' using errcode = '22023';
  end if;
  return found;
end;
$$;

revoke all on function public.insert_leave_ledger_credit(uuid, text, text, date, numeric, text, date) from public, anon, authenticated;
grant execute on function public.insert_leave_ledger_credit(uuid, text, text, date, numeric, text, date) to service_role;
