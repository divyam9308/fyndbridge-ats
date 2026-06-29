create table if not exists public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_user_id uuid not null references auth.users(id) on delete cascade,
  review_period text not null default 'current',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique(employee_user_id, review_period)
);

create index if not exists performance_reviews_employee_user_id_idx
  on public.performance_reviews(employee_user_id);

create index if not exists performance_reviews_review_period_idx
  on public.performance_reviews(review_period);

create table if not exists public.performance_review_rows (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.performance_reviews(id) on delete cascade,
  row_order int not null,
  category text not null,
  allocation numeric not null default 0,
  work_done text default '',
  self_score numeric,
  ss_ns_feedback text default '',
  ss_ns_score numeric,
  ra_feedback text default '',
  ra_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(review_id, row_order),
  constraint performance_review_rows_allocation_check check (allocation >= 0 and allocation <= 100),
  constraint performance_review_rows_self_score_check check (self_score is null or (self_score >= 0 and self_score <= 5)),
  constraint performance_review_rows_ss_ns_score_check check (ss_ns_score is null or (ss_ns_score >= 0 and ss_ns_score <= 5)),
  constraint performance_review_rows_ra_score_check check (ra_score is null or (ra_score >= 0 and ra_score <= 5))
);

create index if not exists performance_review_rows_review_id_idx
  on public.performance_review_rows(review_id);

create index if not exists performance_review_rows_row_order_idx
  on public.performance_review_rows(row_order);

create table if not exists public.performance_column_permissions (
  id uuid primary key default gen_random_uuid(),
  column_key text not null unique,
  access_level text not null default 'everyone',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint performance_column_permissions_column_key_check check (
    column_key in (
      'category',
      'allocation',
      'work_done',
      'self_score',
      'self_rating',
      'ss_ns_feedback',
      'ss_ns_score',
      'ss_ns_rating',
      'ra_feedback',
      'ra_score',
      'final_rating'
    )
  ),
  constraint performance_column_permissions_access_level_check check (
    access_level in ('everyone', 'super_admin_disabled', 'super_admin_hidden')
  )
);

insert into public.performance_column_permissions (column_key, access_level)
values
  ('category', 'everyone'),
  ('allocation', 'everyone'),
  ('work_done', 'everyone'),
  ('self_score', 'everyone'),
  ('self_rating', 'everyone'),
  ('ss_ns_feedback', 'everyone'),
  ('ss_ns_score', 'everyone'),
  ('ss_ns_rating', 'everyone'),
  ('ra_feedback', 'everyone'),
  ('ra_score', 'everyone'),
  ('final_rating', 'everyone')
on conflict (column_key) do nothing;

alter table public.performance_reviews enable row level security;
alter table public.performance_review_rows enable row level security;
alter table public.performance_column_permissions enable row level security;

grant select, insert, update on public.performance_reviews to authenticated;
grant select, insert, update on public.performance_review_rows to authenticated;
grant select on public.performance_column_permissions to authenticated;
grant update on public.performance_column_permissions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_reviews'
      and policyname = 'performance_reviews_select_own_or_super_admin'
  ) then
    create policy performance_reviews_select_own_or_super_admin
    on public.performance_reviews for select
    to authenticated
    using (
      employee_user_id = (select auth.uid())
      or exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_reviews'
      and policyname = 'performance_reviews_insert_own_or_super_admin'
  ) then
    create policy performance_reviews_insert_own_or_super_admin
    on public.performance_reviews for insert
    to authenticated
    with check (
      employee_user_id = (select auth.uid())
      or exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_reviews'
      and policyname = 'performance_reviews_update_own_or_super_admin'
  ) then
    create policy performance_reviews_update_own_or_super_admin
    on public.performance_reviews for update
    to authenticated
    using (
      employee_user_id = (select auth.uid())
      or exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    )
    with check (
      employee_user_id = (select auth.uid())
      or exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_review_rows'
      and policyname = 'performance_review_rows_select_own_or_super_admin'
  ) then
    create policy performance_review_rows_select_own_or_super_admin
    on public.performance_review_rows for select
    to authenticated
    using (
      exists (
        select 1
        from public.performance_reviews pr
        where pr.id = review_id
          and (
            pr.employee_user_id = (select auth.uid())
            or exists (
              select 1
              from public.admin_users
              where role = 'super_admin'
                and (
                  user_id = (select auth.uid())
                  or lower(email) = lower((select auth.jwt()) ->> 'email')
                )
            )
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_review_rows'
      and policyname = 'performance_review_rows_insert_own_or_super_admin'
  ) then
    create policy performance_review_rows_insert_own_or_super_admin
    on public.performance_review_rows for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.performance_reviews pr
        where pr.id = review_id
          and (
            pr.employee_user_id = (select auth.uid())
            or exists (
              select 1
              from public.admin_users
              where role = 'super_admin'
                and (
                  user_id = (select auth.uid())
                  or lower(email) = lower((select auth.jwt()) ->> 'email')
                )
            )
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_review_rows'
      and policyname = 'performance_review_rows_update_own_or_super_admin'
  ) then
    create policy performance_review_rows_update_own_or_super_admin
    on public.performance_review_rows for update
    to authenticated
    using (
      exists (
        select 1
        from public.performance_reviews pr
        where pr.id = review_id
          and (
            pr.employee_user_id = (select auth.uid())
            or exists (
              select 1
              from public.admin_users
              where role = 'super_admin'
                and (
                  user_id = (select auth.uid())
                  or lower(email) = lower((select auth.jwt()) ->> 'email')
                )
            )
          )
      )
    )
    with check (
      exists (
        select 1
        from public.performance_reviews pr
        where pr.id = review_id
          and (
            pr.employee_user_id = (select auth.uid())
            or exists (
              select 1
              from public.admin_users
              where role = 'super_admin'
                and (
                  user_id = (select auth.uid())
                  or lower(email) = lower((select auth.jwt()) ->> 'email')
                )
            )
          )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_column_permissions'
      and policyname = 'performance_column_permissions_select_authenticated'
  ) then
    create policy performance_column_permissions_select_authenticated
    on public.performance_column_permissions for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'performance_column_permissions'
      and policyname = 'performance_column_permissions_update_super_admin'
  ) then
    create policy performance_column_permissions_update_super_admin
    on public.performance_column_permissions for update
    to authenticated
    using (
      exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    )
    with check (
      exists (
        select 1
        from public.admin_users
        where role = 'super_admin'
          and (
            user_id = (select auth.uid())
            or lower(email) = lower((select auth.jwt()) ->> 'email')
          )
      )
    );
  end if;
end $$;
