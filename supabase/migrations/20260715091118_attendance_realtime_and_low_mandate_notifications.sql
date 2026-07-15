-- Attendance Realtime already publishes the four user-scoped attendance
-- tables. Holidays are soft-deactivated and also affect calendars, working-day
-- totals, and leave calculations, so publish only this missing table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_holidays'
  ) then
    alter publication supabase_realtime add table public.company_holidays;
  end if;
end $$;

-- The assignment UI sources consultants from active, named user_profiles. The
-- jobs table stores those assignments by profile name in jobs.consultants.
-- Team-lead-only assignments are intentionally not counted.
create table if not exists public.low_mandate_allocation_state (
  consultant_user_id uuid primary key references auth.users(id) on delete cascade,
  active_mandate_count integer not null default 0 check (active_mandate_count >= 0),
  condition_active boolean not null default false,
  episode_id uuid,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (condition_active = (episode_id is not null))
);

alter table public.low_mandate_allocation_state enable row level security;
revoke all on table public.low_mandate_allocation_state from public, anon, authenticated;

-- Only one visible low-allocation warning may exist for a consultant/recipient
-- pair. The episode idempotency key separately retains warning history and
-- permits a new warning after the consultant first recovers to five mandates.
create unique index if not exists notifications_low_mandate_active_unique_idx
  on public.notifications(recipient_user_id, entity_id)
  where action_type = 'low_mandate_allocation'
    and cleared_at is null;

create or replace function public.low_mandate_active_super_admins()
returns table (recipient_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct resolved.recipient_user_id
  from (
    select
      admin_user.role,
      admin_user.is_super_admin,
      coalesce(
        admin_user.user_id,
        case
          when profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then profile.user_id::uuid
          else null
        end
      ) as recipient_user_id
    from public.admin_users admin_user
    left join public.user_profiles profile
      on admin_user.user_id::text = profile.user_id
      or (
        admin_user.user_id is null
        and lower(btrim(coalesce(admin_user.email, ''))) = lower(btrim(coalesce(profile.email, '')))
      )
  ) resolved
  join auth.users auth_user
    on auth_user.id = resolved.recipient_user_id
  left join public.employee_statuses employee_status
    on employee_status.user_id = resolved.recipient_user_id::text
  where (resolved.role = 'super_admin' or resolved.is_super_admin is true)
    and resolved.recipient_user_id is not null
    and coalesce(employee_status.status, 'active') <> 'inactive';
$$;

revoke all on function public.low_mandate_active_super_admins() from public, anon, authenticated;

create or replace function public.sync_low_mandate_notifications_for_recipient(
  p_recipient_user_id uuid,
  p_key_suffix text default 'current'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient_user_id is null or not exists (
    select 1
    from public.low_mandate_active_super_admins() recipient
    where recipient.recipient_user_id = p_recipient_user_id
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_user_id,
    role_type,
    title,
    message,
    status,
    action_type,
    entity_type,
    entity_id,
    action_url,
    idempotency_key
  )
  select
    p_recipient_user_id,
    'system',
    'Low mandate allocation',
    case state.active_mandate_count
      when 0 then btrim(profile.name) || ' currently has no active mandates assigned. Consider assigning additional mandates.'
      when 1 then btrim(profile.name) || ' currently has only 1 active mandate assigned. Consider assigning additional mandates.'
      else btrim(profile.name) || ' currently has only ' || state.active_mandate_count || ' active mandates assigned. Consider assigning additional mandates.'
    end,
    'pending',
    'low_mandate_allocation',
    'consultant',
    state.consultant_user_id,
    '/dashboard/mandates',
    'low_mandate_allocation:' || state.consultant_user_id || ':' || state.episode_id || ':' || p_recipient_user_id || ':' || coalesce(nullif(p_key_suffix, ''), 'current')
  from public.low_mandate_allocation_state state
  join public.user_profiles profile
    on profile.user_id = state.consultant_user_id::text
  where state.condition_active
    and state.active_mandate_count < 5
    and nullif(btrim(coalesce(profile.name, '')), '') is not null
    and not exists (
      select 1
      from public.notifications existing
      where existing.recipient_user_id = p_recipient_user_id
        and existing.entity_id = state.consultant_user_id
        and existing.action_type = 'low_mandate_allocation'
        and existing.cleared_at is null
    )
  on conflict do nothing;
end;
$$;

revoke all on function public.sync_low_mandate_notifications_for_recipient(uuid, text) from public, anon, authenticated;

create or replace function public.reconcile_low_mandate_allocation(p_consultant_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consultant_name text;
  v_employee_status text;
  v_active_count integer := 0;
  v_condition_active boolean := false;
  v_episode_id uuid;
begin
  if p_consultant_user_id is null then
    return;
  end if;
  if not exists (select 1 from auth.users auth_user where auth_user.id = p_consultant_user_id) then
    return;
  end if;

  -- The state row is the per-consultant transaction lock. Concurrent job
  -- changes serialize here, then count from the latest committed database state.
  insert into public.low_mandate_allocation_state(consultant_user_id)
  values (p_consultant_user_id)
  on conflict (consultant_user_id) do nothing;

  select state.condition_active, state.episode_id
  into v_condition_active, v_episode_id
  from public.low_mandate_allocation_state state
  where state.consultant_user_id = p_consultant_user_id
  for update;

  select btrim(profile.name), employee_status.status
  into v_consultant_name, v_employee_status
  from public.user_profiles profile
  join auth.users auth_user
    on auth_user.id::text = profile.user_id
  join public.employee_statuses employee_status
    on employee_status.user_id = profile.user_id
  where profile.user_id = p_consultant_user_id::text
    and nullif(btrim(coalesce(profile.name, '')), '') is not null
  limit 1;

  if not found or v_employee_status <> 'active' then
    update public.low_mandate_allocation_state
    set active_mandate_count = 0,
        condition_active = false,
        episode_id = null,
        evaluated_at = now(),
        updated_at = now()
    where consultant_user_id = p_consultant_user_id;

    update public.notifications
    set status = 'read',
        read_at = coalesce(read_at, now()),
        cleared_at = coalesce(cleared_at, now())
    where action_type = 'low_mandate_allocation'
      and entity_id = p_consultant_user_id
      and cleared_at is null;
    return;
  end if;

  select count(*)::integer
  into v_active_count
  from public.jobs job
  where lower(btrim(coalesce(job.mandate_status, ''))) = 'ongoing'
    and exists (
      select 1
      from unnest(coalesce(job.consultants, '{}'::text[])) consultant_name
      where lower(btrim(consultant_name)) = lower(v_consultant_name)
    );

  if v_active_count < 5 then
    if not v_condition_active or v_episode_id is null then
      v_episode_id := gen_random_uuid();
    end if;

    update public.low_mandate_allocation_state
    set active_mandate_count = v_active_count,
        condition_active = true,
        episode_id = v_episode_id,
        evaluated_at = now(),
        updated_at = now()
    where consultant_user_id = p_consultant_user_id;

    -- Count changes patch the active card only. Read/cleared fields are never
    -- reset, so marking the warning read does not cause it to reopen.
    update public.notifications
    set title = 'Low mandate allocation',
        message = case v_active_count
          when 0 then v_consultant_name || ' currently has no active mandates assigned. Consider assigning additional mandates.'
          when 1 then v_consultant_name || ' currently has only 1 active mandate assigned. Consider assigning additional mandates.'
          else v_consultant_name || ' currently has only ' || v_active_count || ' active mandates assigned. Consider assigning additional mandates.'
        end
    where action_type = 'low_mandate_allocation'
      and entity_id = p_consultant_user_id
      and cleared_at is null;

    insert into public.notifications (
      recipient_user_id,
      role_type,
      title,
      message,
      status,
      action_type,
      entity_type,
      entity_id,
      action_url,
      idempotency_key
    )
    select
      recipient.recipient_user_id,
      'system',
      'Low mandate allocation',
      case v_active_count
        when 0 then v_consultant_name || ' currently has no active mandates assigned. Consider assigning additional mandates.'
        when 1 then v_consultant_name || ' currently has only 1 active mandate assigned. Consider assigning additional mandates.'
        else v_consultant_name || ' currently has only ' || v_active_count || ' active mandates assigned. Consider assigning additional mandates.'
      end,
      'pending',
      'low_mandate_allocation',
      'consultant',
      p_consultant_user_id,
      '/dashboard/mandates',
      'low_mandate_allocation:' || p_consultant_user_id || ':' || v_episode_id || ':' || recipient.recipient_user_id || ':current'
    from public.low_mandate_active_super_admins() recipient
    where not exists (
      select 1
      from public.notifications existing
      where existing.recipient_user_id = recipient.recipient_user_id
        and existing.entity_id = p_consultant_user_id
        and existing.action_type = 'low_mandate_allocation'
        and existing.cleared_at is null
    )
    on conflict do nothing;
    return;
  end if;

  update public.low_mandate_allocation_state
  set active_mandate_count = v_active_count,
      condition_active = false,
      episode_id = null,
      evaluated_at = now(),
      updated_at = now()
  where consultant_user_id = p_consultant_user_id;

  update public.notifications
  set status = 'read',
      read_at = coalesce(read_at, now()),
      cleared_at = coalesce(cleared_at, now())
  where action_type = 'low_mandate_allocation'
    and entity_id = p_consultant_user_id
    and cleared_at is null;
end;
$$;

revoke all on function public.reconcile_low_mandate_allocation(uuid) from public, anon, authenticated;

create or replace function public.reconcile_low_mandates_after_job_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_consultants text[] := '{}'::text[];
  v_new_consultants text[] := '{}'::text[];
  v_consultant_user_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_consultants := coalesce(old.consultants, '{}'::text[]);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_consultants := coalesce(new.consultants, '{}'::text[]);
  end if;

  for v_consultant_user_id in
    select distinct case
      when profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then profile.user_id::uuid
      else null
    end
    from unnest(v_old_consultants || v_new_consultants) assigned_name
    join public.user_profiles profile
      on lower(btrim(profile.name)) = lower(btrim(assigned_name))
    where profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and nullif(btrim(coalesce(assigned_name, '')), '') is not null
  loop
    perform public.reconcile_low_mandate_allocation(v_consultant_user_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_low_mandates_after_job_change() from public, anon, authenticated;

drop trigger if exists jobs_reconcile_low_mandate_allocation on public.jobs;
create trigger jobs_reconcile_low_mandate_allocation
  after insert or delete or update of consultants, mandate_status, status
  on public.jobs
  for each row
  execute function public.reconcile_low_mandates_after_job_change();

create or replace function public.reconcile_low_mandates_after_employee_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if new.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_user_id := new.user_id::uuid;

  perform public.reconcile_low_mandate_allocation(v_user_id);

  if new.status = 'inactive' then
    update public.notifications
    set status = 'read',
        read_at = coalesce(read_at, now()),
        cleared_at = coalesce(cleared_at, now())
    where recipient_user_id = v_user_id
      and action_type = 'low_mandate_allocation'
      and cleared_at is null;
  elsif tg_op = 'INSERT' then
    perform public.sync_low_mandate_notifications_for_recipient(v_user_id, gen_random_uuid()::text);
  elsif old.status = 'inactive' then
    perform public.sync_low_mandate_notifications_for_recipient(v_user_id, gen_random_uuid()::text);
  end if;

  return new;
end;
$$;

revoke all on function public.reconcile_low_mandates_after_employee_status_change() from public, anon, authenticated;

drop trigger if exists employee_statuses_reconcile_low_mandate_allocation on public.employee_statuses;
create trigger employee_statuses_reconcile_low_mandate_allocation
  after insert or update of status
  on public.employee_statuses
  for each row
  execute function public.reconcile_low_mandates_after_employee_status_change();

create or replace function public.reconcile_low_mandates_after_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_user_id uuid;
  v_new_user_id uuid;
  v_old_super_admin boolean := false;
  v_new_super_admin boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_user_id := old.user_id;
    if v_old_user_id is null then
      select case
        when profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then profile.user_id::uuid
        else null
      end
      into v_old_user_id
      from public.user_profiles profile
      where lower(btrim(coalesce(profile.email, ''))) = lower(btrim(coalesce(old.email, '')))
        and profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      limit 1;
    end if;
    v_old_super_admin := old.role = 'super_admin' or old.is_super_admin is true;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_user_id := new.user_id;
    if v_new_user_id is null then
      select case
        when profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then profile.user_id::uuid
        else null
      end
      into v_new_user_id
      from public.user_profiles profile
      where lower(btrim(coalesce(profile.email, ''))) = lower(btrim(coalesce(new.email, '')))
        and profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      limit 1;
    end if;
    v_new_super_admin := new.role = 'super_admin' or new.is_super_admin is true;
  end if;

  if v_old_super_admin and v_old_user_id is not null
    and (not v_new_super_admin or v_new_user_id is distinct from v_old_user_id) then
    update public.notifications
    set status = 'read',
        read_at = coalesce(read_at, now()),
        cleared_at = coalesce(cleared_at, now())
    where recipient_user_id = v_old_user_id
      and action_type = 'low_mandate_allocation'
      and cleared_at is null;
  end if;

  if v_new_super_admin and v_new_user_id is not null
    and (not v_old_super_admin or v_new_user_id is distinct from v_old_user_id) then
    perform public.sync_low_mandate_notifications_for_recipient(v_new_user_id, gen_random_uuid()::text);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_low_mandates_after_admin_change() from public, anon, authenticated;

drop trigger if exists admin_users_reconcile_low_mandate_allocation on public.admin_users;
create trigger admin_users_reconcile_low_mandate_allocation
  after insert or delete or update of role, is_super_admin, user_id, email
  on public.admin_users
  for each row
  execute function public.reconcile_low_mandates_after_admin_change();

-- One set-based initial evaluation. Existing low-allocation consultants receive
-- one warning per currently active Super Admin without an application N+1 scan.
with active_consultants as (
  select case
    when profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then profile.user_id::uuid
    else null
  end as consultant_user_id,
  btrim(profile.name) as consultant_name
  from public.user_profiles profile
  join auth.users auth_user
    on auth_user.id::text = profile.user_id
  join public.employee_statuses employee_status
    on employee_status.user_id = profile.user_id
   and employee_status.status = 'active'
  where profile.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and nullif(btrim(coalesce(profile.name, '')), '') is not null
), active_counts as (
  select
    consultant.consultant_user_id,
    count(job.id)::integer as active_mandate_count
  from active_consultants consultant
  left join public.jobs job
    on lower(btrim(coalesce(job.mandate_status, ''))) = 'ongoing'
   and exists (
     select 1
     from unnest(coalesce(job.consultants, '{}'::text[])) assigned_name
     where lower(btrim(assigned_name)) = lower(consultant.consultant_name)
   )
  group by consultant.consultant_user_id
)
insert into public.low_mandate_allocation_state (
  consultant_user_id,
  active_mandate_count,
  condition_active,
  episode_id,
  evaluated_at,
  updated_at
)
select
  count_row.consultant_user_id,
  count_row.active_mandate_count,
  count_row.active_mandate_count < 5,
  case when count_row.active_mandate_count < 5 then gen_random_uuid() else null end,
  now(),
  now()
from active_counts count_row
on conflict (consultant_user_id) do update
set active_mandate_count = excluded.active_mandate_count,
    condition_active = excluded.condition_active,
    episode_id = case
      when excluded.condition_active then coalesce(public.low_mandate_allocation_state.episode_id, excluded.episode_id)
      else null
    end,
    evaluated_at = now(),
    updated_at = now();

update public.low_mandate_allocation_state state
set active_mandate_count = 0,
    condition_active = false,
    episode_id = null,
    evaluated_at = now(),
    updated_at = now()
where not exists (
  select 1
  from public.user_profiles profile
  join public.employee_statuses employee_status
    on employee_status.user_id = profile.user_id
   and employee_status.status = 'active'
  where profile.user_id = state.consultant_user_id::text
    and nullif(btrim(coalesce(profile.name, '')), '') is not null
);

insert into public.notifications (
  recipient_user_id,
  role_type,
  title,
  message,
  status,
  action_type,
  entity_type,
  entity_id,
  action_url,
  idempotency_key
)
select
  recipient.recipient_user_id,
  'system',
  'Low mandate allocation',
  case state.active_mandate_count
    when 0 then btrim(profile.name) || ' currently has no active mandates assigned. Consider assigning additional mandates.'
    when 1 then btrim(profile.name) || ' currently has only 1 active mandate assigned. Consider assigning additional mandates.'
    else btrim(profile.name) || ' currently has only ' || state.active_mandate_count || ' active mandates assigned. Consider assigning additional mandates.'
  end,
  'pending',
  'low_mandate_allocation',
  'consultant',
  state.consultant_user_id,
  '/dashboard/mandates',
  'low_mandate_allocation:' || state.consultant_user_id || ':' || state.episode_id || ':' || recipient.recipient_user_id || ':current'
from public.low_mandate_allocation_state state
join public.user_profiles profile
  on profile.user_id = state.consultant_user_id::text
cross join public.low_mandate_active_super_admins() recipient
where state.condition_active
  and state.active_mandate_count < 5
  and not exists (
    select 1
    from public.notifications existing
    where existing.recipient_user_id = recipient.recipient_user_id
      and existing.entity_id = state.consultant_user_id
      and existing.action_type = 'low_mandate_allocation'
      and existing.cleared_at is null
  )
on conflict do nothing;
