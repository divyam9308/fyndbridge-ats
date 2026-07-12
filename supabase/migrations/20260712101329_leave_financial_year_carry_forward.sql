alter table public.leave_ledger
  add column if not exists financial_year text;

alter table public.leave_ledger
  drop constraint if exists leave_ledger_financial_year_format;
alter table public.leave_ledger
  add constraint leave_ledger_financial_year_format
  check (financial_year is null or financial_year ~ '^FY [0-9]{4}-[0-9]{2}$');

update public.leave_ledger ledger
set financial_year = 'FY ' || extract(year from ledger.entry_date)::integer::text || '-' ||
  right((extract(year from ledger.entry_date)::integer + 1)::text, 2)
where ledger.financial_year is null
  and extract(month from ledger.entry_date) >= 4;

update public.leave_ledger ledger
set financial_year = 'FY ' || (extract(year from ledger.entry_date)::integer - 1)::text || '-' ||
  right(extract(year from ledger.entry_date)::integer::text, 2)
where ledger.financial_year is null
  and extract(month from ledger.entry_date) < 4;

update public.leave_ledger ledger
set financial_year = case
  when extract(month from request.start_date) >= 4 then
    'FY ' || extract(year from request.start_date)::integer::text || '-' || right((extract(year from request.start_date)::integer + 1)::text, 2)
  else
    'FY ' || (extract(year from request.start_date)::integer - 1)::text || '-' || right(extract(year from request.start_date)::integer::text, 2)
end,
entry_date = request.start_date
from public.leave_requests request
where ledger.leave_request_id = request.id
  and ledger.entry_type = 'leave_used';

create index if not exists leave_ledger_financial_year_idx
  on public.leave_ledger(user_id, financial_year, entry_date);

create unique index if not exists leave_ledger_opening_balance_fy_idx
  on public.leave_ledger(user_id, financial_year)
  where entry_type = 'opening_balance';

drop index if exists leave_ledger_monthly_accrual_idx;
create unique index leave_ledger_monthly_accrual_idx
  on public.leave_ledger(user_id, financial_year, accrual_month)
  where entry_type = 'accrual';
