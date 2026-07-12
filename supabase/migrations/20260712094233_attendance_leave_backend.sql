create extension if not exists btree_gist with schema extensions;

create table if not exists public.attendance_permissions (
  permission_key text primary key,
  access_level text not null default 'admins' check (access_level in ('admins','super_admins')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.attendance_permissions(permission_key, access_level) values
 ('attendance_approve_corrections','admins'), ('attendance_approve_leave','admins'),
 ('attendance_view_all','admins'), ('attendance_manage_holidays','admins'),
 ('attendance_receive_correction_notifications','admins'), ('attendance_receive_leave_notifications','admins')
on conflict (permission_key) do nothing;

create table if not exists public.attendance_correction_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 attendance_date date not null, existing_clock_in_at timestamptz, existing_clock_out_at timestamptz,
 requested_clock_in_at timestamptz not null, requested_clock_out_at timestamptz not null,
 requested_worked_minutes integer not null check (requested_worked_minutes >= 0),
 reason text not null check (length(btrim(reason)) > 0), status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
 reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, review_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (requested_clock_out_at > requested_clock_in_at)
);
create unique index if not exists attendance_corrections_one_pending_idx on public.attendance_correction_requests(user_id,attendance_date) where status='pending';
create index if not exists attendance_corrections_user_date_idx on public.attendance_correction_requests(user_id,attendance_date);
create index if not exists attendance_corrections_status_idx on public.attendance_correction_requests(status);
create index if not exists attendance_corrections_reviewer_idx on public.attendance_correction_requests(reviewed_by);
create index if not exists attendance_corrections_created_idx on public.attendance_correction_requests(created_at);

create table if not exists public.leave_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 start_date date not null, end_date date not null, duration_type text not null check(duration_type in ('full_day','half_day')),
 half_day_session text check(half_day_session in ('first_half','second_half')), reason text not null check(length(btrim(reason))>0),
 charged_leave_days numeric(6,2) not null check(charged_leave_days>=0), paid_leave_days numeric(6,2) not null check(paid_leave_days>=0),
 loss_of_pay_days numeric(6,2) not null default 0 check(loss_of_pay_days>=0), balance_before numeric(6,2) not null,
 projected_balance numeric(6,2) not null, calculation_breakdown jsonb not null default '[]'::jsonb,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, review_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_date>=start_date), check((duration_type='half_day' and half_day_session is not null and start_date=end_date) or (duration_type='full_day' and half_day_session is null))
);
alter table public.leave_requests drop constraint if exists leave_requests_no_overlap;
alter table public.leave_requests add constraint leave_requests_no_overlap exclude using gist
 (user_id with =, daterange(start_date,end_date,'[]') with &&) where (status in ('pending','approved'));
create index if not exists leave_requests_user_dates_idx on public.leave_requests(user_id,start_date,end_date);
create index if not exists leave_requests_status_idx on public.leave_requests(status);
create index if not exists leave_requests_created_idx on public.leave_requests(created_at);

create table if not exists public.leave_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 entry_date date not null, entry_type text not null check(entry_type in ('opening_balance','accrual','leave_used','adjustment','reversal')),
 amount numeric(6,2) not null, leave_request_id uuid references public.leave_requests(id) on delete restrict,
 description text, accrual_month date, created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null,
 check((entry_type='accrual' and amount>0) or (entry_type='leave_used' and amount<0) or entry_type in ('opening_balance','adjustment','reversal'))
);
create unique index if not exists leave_ledger_monthly_accrual_idx on public.leave_ledger(user_id,accrual_month) where entry_type='accrual';
create unique index if not exists leave_ledger_request_debit_idx on public.leave_ledger(leave_request_id) where entry_type='leave_used';
create index if not exists leave_ledger_user_date_idx on public.leave_ledger(user_id,entry_date);
create index if not exists leave_ledger_request_idx on public.leave_ledger(leave_request_id);
create index if not exists leave_ledger_type_idx on public.leave_ledger(entry_type);

create table if not exists public.company_holidays (
 id uuid primary key default gen_random_uuid(), holiday_name text not null check(length(btrim(holiday_name))>0), holiday_date date not null,
 holiday_type text not null check(holiday_type in ('national','company','optional')), description text, is_active boolean not null default true,
 created_by uuid not null references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists company_holidays_active_date_idx on public.company_holidays(holiday_date) where is_active;
create index if not exists company_holidays_date_idx on public.company_holidays(holiday_date);
create index if not exists company_holidays_active_idx on public.company_holidays(is_active);
create index if not exists company_holidays_type_idx on public.company_holidays(holiday_type);

create table if not exists public.attendance_records (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, attendance_date date not null,
 clock_in_at timestamptz, clock_out_at timestamptz, worked_minutes integer check(worked_minutes>=0),
 status text not null default 'not_marked' check(status in ('not_marked','clocked_in','present','on_leave','half_day_leave','holiday','weekly_off','correction_pending','corrected','absent')),
 source text not null default 'clock', correction_request_id uuid references public.attendance_correction_requests(id) on delete set null,
 leave_request_id uuid references public.leave_requests(id) on delete set null, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id), updated_by uuid references auth.users(id), unique(user_id,attendance_date),
 check(clock_out_at is null or clock_in_at is null or clock_out_at>clock_in_at)
);
create index if not exists attendance_records_user_date_idx on public.attendance_records(user_id,attendance_date);
create index if not exists attendance_records_date_idx on public.attendance_records(attendance_date);
create index if not exists attendance_records_status_idx on public.attendance_records(status);
create index if not exists attendance_records_user_status_idx on public.attendance_records(user_id,status);

alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id uuid;
alter table public.notifications add column if not exists action_url text;
alter table public.notifications add column if not exists idempotency_key text;
create unique index if not exists notifications_idempotency_key_idx on public.notifications(idempotency_key) where idempotency_key is not null;

alter table public.attendance_permissions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_correction_requests enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_ledger enable row level security;
alter table public.company_holidays enable row level security;

drop policy if exists attendance_permissions_read on public.attendance_permissions;
create policy attendance_permissions_read on public.attendance_permissions for select to authenticated using(true);

drop policy if exists attendance_records_own_read on public.attendance_records;
create policy attendance_records_own_read on public.attendance_records for select to authenticated using((select auth.uid())=user_id);

drop policy if exists corrections_own_read on public.attendance_correction_requests;
create policy corrections_own_read on public.attendance_correction_requests for select to authenticated using((select auth.uid())=user_id);

drop policy if exists leaves_own_read on public.leave_requests;
create policy leaves_own_read on public.leave_requests for select to authenticated using((select auth.uid())=user_id);

drop policy if exists ledger_own_read on public.leave_ledger;
create policy ledger_own_read on public.leave_ledger for select to authenticated using((select auth.uid())=user_id);

drop policy if exists holidays_active_read on public.company_holidays;
create policy holidays_active_read on public.company_holidays for select to authenticated using(is_active);

grant select on public.attendance_permissions, public.attendance_records, public.attendance_correction_requests, public.leave_requests, public.leave_ledger, public.company_holidays to authenticated;
revoke insert,update,delete on public.attendance_permissions, public.attendance_records, public.attendance_correction_requests, public.leave_requests, public.leave_ledger, public.company_holidays from anon,authenticated;
