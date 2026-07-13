-- Some production projects predate the standalone assignment-column SQL files.
-- Add only the ownership columns used by Employee Management before creating
-- functions that reference them. These statements preserve all existing data.
alter table public.clients
  add column if not exists consultant_name text,
  add column if not exists consultant_user_id uuid,
  add column if not exists client_name text;

alter table public.candidate_associations
  add column if not exists consultant_name text,
  add column if not exists consultant_user_id uuid;

create index if not exists clients_consultant_user_id_idx
  on public.clients(consultant_user_id);

create index if not exists candidate_associations_consultant_user_id_idx
  on public.candidate_associations(consultant_user_id);

create table if not exists public.employee_statuses (
  user_id text primary key references public.user_profiles(user_id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'on_leave', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists employee_statuses_status_idx
  on public.employee_statuses(status);

insert into public.employee_statuses(user_id, status)
select profile.user_id, 'active'
from public.user_profiles profile
where nullif(btrim(profile.name), '') is not null
on conflict (user_id) do nothing;

create or replace function public.ensure_employee_status_after_profile_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.name), '') is not null then
    insert into public.employee_statuses(user_id, status)
    values (new.user_id, 'active')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_employee_status_after_profile_name() from public, anon, authenticated;

drop trigger if exists user_profiles_ensure_employee_status on public.user_profiles;
create trigger user_profiles_ensure_employee_status
  after insert or update of name on public.user_profiles
  for each row execute function public.ensure_employee_status_after_profile_name();

alter table public.employee_statuses enable row level security;

create or replace function public.is_current_employee_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select status <> 'inactive'
    from public.employee_statuses
    where user_id = (select auth.uid())::text
  ), true);
$$;

revoke all on function public.is_current_employee_active() from public, anon;
grant execute on function public.is_current_employee_active() to authenticated;

drop policy if exists employee_statuses_authenticated_read on public.employee_statuses;
create policy employee_statuses_authenticated_read
  on public.employee_statuses
  for select
  to authenticated
  using (user_id = (select auth.uid())::text or public.is_current_employee_active());

grant select on public.employee_statuses to authenticated;
revoke insert, update, delete on public.employee_statuses from anon, authenticated;

drop policy if exists page_view_permissions_select_authenticated on public.page_view_permissions;
create policy page_view_permissions_select_authenticated
  on public.page_view_permissions
  for select
  to authenticated
  using (public.is_current_employee_active());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_statuses'
  ) then
    alter publication supabase_realtime add table public.employee_statuses;
  end if;
end $$;

create or replace function public.employee_management_list()
returns table (
  user_id text,
  name text,
  email text,
  mobile text,
  status text,
  client_count bigint,
  mandate_count bigint,
  candidate_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with valid_profiles as (
    select p.user_id, btrim(p.name) as name, coalesce(p.email, '') as email, coalesce(p.mobile_number, '') as mobile
    from public.user_profiles p
    where nullif(btrim(p.name), '') is not null
  ), client_counts as (
    select p.user_id, count(c.id)::bigint as total
    from valid_profiles p
    join public.clients c
      on c.consultant_user_id::text = p.user_id
      or (c.consultant_user_id is null and lower(btrim(coalesce(c.consultant_name, ''))) = lower(p.name))
    group by p.user_id
  ), mandate_counts as (
    select p.user_id, count(j.id)::bigint as total
    from valid_profiles p
    join public.jobs j on (
      lower(btrim(coalesce(j.team_lead, ''))) = lower(p.name)
      or exists (
        select 1 from unnest(coalesce(j.consultants, '{}'::text[])) consultant
        where lower(btrim(consultant)) = lower(p.name)
      )
    )
    group by p.user_id
  ), candidate_counts as (
    select p.user_id, count(a.id)::bigint as total
    from valid_profiles p
    join public.candidate_associations a
      on a.consultant_user_id::text = p.user_id
      or (a.consultant_user_id is null and lower(btrim(coalesce(a.consultant_name, ''))) = lower(p.name))
    group by p.user_id
  )
  select
    p.user_id,
    p.name,
    p.email,
    p.mobile,
    coalesce(s.status, 'active') as status,
    coalesce(cc.total, 0)::bigint as client_count,
    coalesce(mc.total, 0)::bigint as mandate_count,
    coalesce(cac.total, 0)::bigint as candidate_count
  from valid_profiles p
  left join public.employee_statuses s on s.user_id = p.user_id
  left join client_counts cc on cc.user_id = p.user_id
  left join mandate_counts mc on mc.user_id = p.user_id
  left join candidate_counts cac on cac.user_id = p.user_id
  order by lower(p.name), p.user_id;
$$;

revoke all on function public.employee_management_list() from public, anon, authenticated;
grant execute on function public.employee_management_list() to service_role;

create or replace function public.employee_management_detail(p_employee_id text, p_preview_limit integer default 4)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.user_id,
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('id', preview.id, 'name', preview.name) order by lower(preview.name), preview.id)
      from (
        select c.id::text as id, coalesce(nullif(btrim(c.client_name), ''), nullif(btrim(c.name), ''), 'Unnamed client') as name
        from public.clients c
        where c.consultant_user_id::text = p.user_id
          or (c.consultant_user_id is null and lower(btrim(coalesce(c.consultant_name, ''))) = lower(btrim(p.name)))
        order by lower(coalesce(nullif(btrim(c.client_name), ''), nullif(btrim(c.name), ''), 'Unnamed client')), c.id
        limit greatest(1, least(coalesce(p_preview_limit, 4), 10))
      ) preview
    ), '[]'::jsonb),
    'mandates', coalesce((
      select jsonb_agg(jsonb_build_object('id', preview.id, 'name', preview.name) order by lower(preview.name), preview.id)
      from (
        select j.id::text as id, coalesce(nullif(btrim(j.title), ''), 'Unnamed mandate') as name
        from public.jobs j
        where lower(btrim(coalesce(j.team_lead, ''))) = lower(btrim(p.name))
          or exists (
            select 1 from unnest(coalesce(j.consultants, '{}'::text[])) consultant
            where lower(btrim(consultant)) = lower(btrim(p.name))
          )
        order by lower(coalesce(nullif(btrim(j.title), ''), 'Unnamed mandate')), j.id
        limit greatest(1, least(coalesce(p_preview_limit, 4), 10))
      ) preview
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', preview.id, 'name', preview.name) order by lower(preview.name), preview.id)
      from (
        select a.id::text as id, coalesce(nullif(btrim(c.full_name), ''), 'Unnamed candidate') as name
        from public.candidate_associations a
        join public.candidates c on c.id = a.candidate_id
        where a.consultant_user_id::text = p.user_id
          or (a.consultant_user_id is null and lower(btrim(coalesce(a.consultant_name, ''))) = lower(btrim(p.name)))
        order by lower(coalesce(nullif(btrim(c.full_name), ''), 'Unnamed candidate')), a.id
        limit greatest(1, least(coalesce(p_preview_limit, 4), 10))
      ) preview
    ), '[]'::jsonb)
  )
  from public.user_profiles p
  where p.user_id = p_employee_id
    and nullif(btrim(p.name), '') is not null;
$$;

revoke all on function public.employee_management_detail(text, integer) from public, anon, authenticated;
grant execute on function public.employee_management_detail(text, integer) to service_role;

create or replace function public.reassign_employee_assignments(
  p_actor_id uuid,
  p_actor_email text,
  p_source_user_id text,
  p_destination_user_id text,
  p_categories text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_name text;
  destination_name text;
  destination_status text;
  client_total integer := 0;
  mandate_total integer := 0;
  candidate_total integer := 0;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.admin_users admin_user
    where (admin_user.user_id = p_actor_id
       or lower(coalesce(admin_user.email, '')) = lower(coalesce(p_actor_email, '')))
      and admin_user.role = 'super_admin'
  ) then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  if p_source_user_id is null or p_destination_user_id is null or p_source_user_id = p_destination_user_id then
    raise exception 'Select a valid source and destination employee' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_categories), 0) = 0
     or exists (select 1 from unnest(p_categories) category where category not in ('clients', 'mandates', 'candidates')) then
    raise exception 'Select at least one valid assignment category' using errcode = '22023';
  end if;

  select btrim(profile.name) into source_name
  from public.user_profiles profile
  where profile.user_id = p_source_user_id and nullif(btrim(profile.name), '') is not null;

  select btrim(profile.name), coalesce(status_row.status, 'active')
  into destination_name, destination_status
  from public.user_profiles profile
  left join public.employee_statuses status_row on status_row.user_id = profile.user_id
  where profile.user_id = p_destination_user_id and nullif(btrim(profile.name), '') is not null;

  if source_name is null then
    raise exception 'Source employee not found' using errcode = 'P0002';
  end if;
  if destination_name is null then
    raise exception 'Destination employee not found' using errcode = 'P0002';
  end if;
  if destination_status <> 'active' then
    raise exception 'Destination employee must be Active' using errcode = '22023';
  end if;

  if 'clients' = any(p_categories) then
    with updated as (
      update public.clients client
      set consultant_user_id = p_destination_user_id::uuid,
          consultant_name = destination_name,
          updated_at = now()
      where client.consultant_user_id::text = p_source_user_id
         or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name))
      returning 1
    )
    select count(*) into client_total from updated;
  end if;

  if 'mandates' = any(p_categories) then
    with updated as (
      update public.jobs job
      set consultants = case
            when exists (
              select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
              where lower(btrim(consultant)) = lower(source_name)
            ) then coalesce((
              select array_agg(deduplicated.value order by deduplicated.ordinality)
              from (
                select distinct on (lower(btrim(replaced.value))) replaced.value, replaced.ordinality
                from (
                  select case when lower(btrim(item.value)) = lower(source_name) then destination_name else item.value end as value,
                         item.ordinality
                  from unnest(coalesce(job.consultants, '{}'::text[])) with ordinality as item(value, ordinality)
                ) replaced
                order by lower(btrim(replaced.value)), replaced.ordinality
              ) deduplicated
            ), '{}'::text[])
            else coalesce(job.consultants, '{}'::text[])
          end,
          team_lead = case when lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name) then destination_name else job.team_lead end,
          updated_at = now()
      where lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
         or exists (
           select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
           where lower(btrim(consultant)) = lower(source_name)
         )
      returning 1
    )
    select count(*) into mandate_total from updated;
  end if;

  if 'candidates' = any(p_categories) then
    with updated as (
      update public.candidate_associations association
      set consultant_user_id = p_destination_user_id::uuid,
          consultant_name = destination_name,
          updated_at = now()
      where association.consultant_user_id::text = p_source_user_id
         or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name))
      returning 1
    )
    select count(*) into candidate_total from updated;
  end if;

  return jsonb_build_object(
    'source_user_id', p_source_user_id,
    'destination_user_id', p_destination_user_id,
    'destination_name', destination_name,
    'clients', client_total,
    'mandates', mandate_total,
    'candidates', candidate_total
  );
end;
$$;

revoke all on function public.reassign_employee_assignments(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.reassign_employee_assignments(uuid, text, text, text, text[]) to service_role;
