-- Canonical mandate lifecycle values are stored in both the primary
-- mandate_status column and the legacy-compatible status column.
with normalized as (
  select
    id,
    case
      when lower(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, ''))) in
        ('p1', 'ongoing', 'ongoing (p1)', 'open', 'active')
        then 'Ongoing (P1)'
      when lower(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, ''))) in
        ('p2', 'delivered', 'delivered (p2)')
        then 'Delivered (P2)'
      when lower(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, ''))) in
        ('p3', 'paused', 'paused (p3)', 'on hold', 'on-hold')
        then 'Paused (P3)'
      when lower(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, ''))) in
        ('completed', 'complete', 'closed', 'filled')
        then 'Completed'
      when lower(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, ''))) in
        ('scrapped', 'scrap', 'cancelled', 'canceled', 'abandoned')
        then 'Scrapped'
      else coalesce(
        nullif(btrim(coalesce(nullif(mandate_status, '-'), nullif(status, '-'), priority, '')), ''),
        'Ongoing (P1)'
      )
    end as next_status
  from public.jobs
)
update public.jobs job
set mandate_status = normalized.next_status,
    status = normalized.next_status
from normalized
where job.id = normalized.id
  and (
    job.mandate_status is distinct from normalized.next_status
    or job.status is distinct from normalized.next_status
  );

alter table public.jobs
  alter column mandate_status set default 'Ongoing (P1)',
  alter column mandate_status set not null,
  alter column status set default 'Ongoing (P1)',
  alter column status set not null;

alter table public.jobs
  drop constraint if exists jobs_mandate_status_valid,
  drop constraint if exists jobs_status_matches_mandate_status;

alter table public.jobs
  add constraint jobs_mandate_status_valid
    check (mandate_status in ('Ongoing (P1)', 'Delivered (P2)', 'Paused (P3)', 'Completed', 'Scrapped'))
    not valid,
  add constraint jobs_status_matches_mandate_status
    check (status is not distinct from mandate_status)
    not valid;

alter table public.jobs validate constraint jobs_mandate_status_valid;
alter table public.jobs validate constraint jobs_status_matches_mandate_status;

-- Preserve the existing notification lifecycle and audience. Only the active
-- count changes: it now counts exact Ongoing (P1) assignments and excludes P2/P3.
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
    and not exists (
      select 1
      from public.admin_users admin_user
      where admin_user.user_id = p_consultant_user_id
        or lower(btrim(coalesce(admin_user.email, ''))) = lower(btrim(coalesce(profile.email, '')))
    )
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
  where lower(btrim(coalesce(job.mandate_status, ''))) = 'ongoing (p1)'
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
      '/dashboard/jobs',
      'low_mandate_allocation:' || p_consultant_user_id || ':' || v_episode_id || ':' || recipient.recipient_user_id || ':current'
    from public.low_mandate_notification_recipients() recipient
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

-- Reconcile the existing state rows against P1-only counts after the backfill.
do $$
declare
  state_row record;
begin
  for state_row in
    select consultant_user_id
    from public.low_mandate_allocation_state
  loop
    perform public.reconcile_low_mandate_allocation(state_row.consultant_user_id);
  end loop;
end;
$$;
