-- Super Admin-only record management.
-- All functions are server-only (service_role) and destructive work is kept in
-- one Postgres transaction. Resume metadata and storage objects are untouched.

update public.admin_users admin_user
set user_id = auth_user.id
from auth.users auth_user
where admin_user.user_id is null
  and lower(admin_user.email) = lower(auth_user.email);

alter table public.candidate_associations
  drop constraint if exists candidate_associations_client_id_required,
  drop constraint if exists candidate_associations_job_id_required;

create or replace function public.validate_candidate_association_job_client()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_job public.jobs%rowtype;
begin
  -- Detached rows are valid after an authorized mandate/client deletion.
  if new.job_id is null then
    new.job_title := null;
    if new.client_id is null then
      new.client_name := null;
    end if;
    return new;
  end if;

  if new.client_id is null then
    raise exception 'candidate_associations.client_id is required when job_id is set';
  end if;

  select * into selected_job
  from public.jobs
  where id = new.job_id;

  if selected_job.id is null then
    raise exception 'candidate_associations.job_id must reference an existing job';
  end if;
  if selected_job.client_id <> new.client_id then
    raise exception 'candidate_associations.job_id must belong to selected client_id';
  end if;

  new.job_title := selected_job.title;
  return new;
end;
$$;

revoke all on function public.validate_candidate_association_job_client()
  from public, anon, authenticated;

-- Normalize the key deletion actions even if an older environment used
-- different automatically generated FK names.
do $$
declare
  item record;
begin
  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.candidate_associations'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (job_id)%'
  loop
    execute format('alter table public.candidate_associations drop constraint %I', item.conname);
  end loop;

  alter table public.candidate_associations
    add constraint candidate_associations_job_id_fkey
    foreign key (job_id) references public.jobs(id) on delete set null;

  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.candidate_associations'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (client_id)%'
  loop
    execute format('alter table public.candidate_associations drop constraint %I', item.conname);
  end loop;

  alter table public.candidate_associations
    add constraint candidate_associations_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete set null;

  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.candidates'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (client_id)%'
  loop
    execute format('alter table public.candidates drop constraint %I', item.conname);
  end loop;

  alter table public.candidates
    add constraint candidates_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete set null;

  for item in
    select conname
    from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (client_id)%'
  loop
    execute format('alter table public.jobs drop constraint %I', item.conname);
  end loop;

  alter table public.jobs
    add constraint jobs_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete cascade;
end;
$$;

create table if not exists public.record_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique,
  actor_user_id uuid not null,
  entity_type text not null check (entity_type in ('candidate', 'mandate', 'client')),
  selected_ids uuid[] not null,
  selected_labels jsonb not null default '[]'::jsonb,
  delete_linked_candidate_rows boolean not null default false,
  candidates_deleted integer not null default 0,
  candidates_retained integer not null default 0,
  mandates_deleted integer not null default 0,
  clients_deleted integer not null default 0,
  client_contacts_deleted integer not null default 0,
  dependent_records_deleted integer not null default 0,
  status text not null default 'success' check (status in ('success', 'failure')),
  created_at timestamptz not null default now()
);

alter table public.record_deletion_audit enable row level security;
revoke all on table public.record_deletion_audit from public, anon, authenticated;
grant select, insert on table public.record_deletion_audit to service_role;

create or replace function public.admin_bulk_record_list(
  p_entity_type text,
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_search text := btrim(coalesce(p_search, ''));
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  result jsonb;
begin
  if p_entity_type not in ('candidate', 'mandate', 'client') then
    raise exception 'Invalid entity type' using errcode = '22023';
  end if;

  if p_entity_type = 'candidate' then
    with candidate_rows as (
      select
        association.id,
        'association'::text as row_kind,
        candidate.full_name as label,
        candidate.email,
        candidate.mobile_number,
        coalesce(job.title, association.job_title) as mandate,
        coalesce(client.client_name, client.name, association.client_name) as client,
        association.consultant_name as consultant,
        association.status,
        association.created_at
      from public.candidate_associations association
      join public.candidates candidate on candidate.id = association.candidate_id
      left join public.jobs job on job.id = association.job_id
      left join public.clients client on client.id = association.client_id
      union all
      select
        candidate.id,
        'candidate'::text,
        candidate.full_name,
        candidate.email,
        candidate.mobile_number,
        null::text,
        client.client_name,
        null::text,
        '-'::text,
        candidate.created_at
      from public.candidates candidate
      left join public.clients client on client.id = candidate.client_id
      where not exists (
        select 1 from public.candidate_associations association
        where association.candidate_id = candidate.id
      )
    ),
    filtered as (
      select *
      from candidate_rows
      where normalized_search = ''
        or concat_ws(' ', label, email, mobile_number, mandate, client, consultant, status)
          ilike '%' || normalized_search || '%'
    ),
    paged as (
      select *
      from filtered
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'offset', safe_offset,
      'limit', safe_limit
    ) into result;
  elsif p_entity_type = 'mandate' then
    with rows as (
      select
        job.id,
        job.title as label,
        coalesce(client.client_name, client.name) as client,
        job.mandate_status as status,
        array_to_string(job.consultants, ', ') as consultants,
        job.team_lead,
        count(association.id)::integer as candidate_count,
        job.allocation_date,
        job.created_at
      from public.jobs job
      left join public.clients client on client.id = job.client_id
      left join public.candidate_associations association on association.job_id = job.id
      where normalized_search = ''
        or concat_ws(
          ' ',
          job.title,
          client.client_name,
          client.name,
          job.mandate_status,
          array_to_string(job.consultants, ', '),
          job.team_lead
        ) ilike '%' || normalized_search || '%'
      group by job.id, client.client_name, client.name
    ),
    paged as (
      select * from rows
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged), '[]'::jsonb),
      'total', (select count(*) from rows),
      'offset', safe_offset,
      'limit', safe_limit
    ) into result;
  else
    with roots as (
      select client.*
      from public.clients client
      where client.client_group_id is null or client.client_group_id = client.id
    ),
    rows as (
      select
        root.id,
        coalesce(root.client_name, root.name) as label,
        root.consultant_name as consultant,
        root.status,
        coalesce(root.location, root.city) as location,
        count(distinct job.id)::integer as mandate_count,
        count(distinct association.id)::integer as candidate_count,
        root.created_at
      from roots root
      left join public.clients member on member.client_group_id = root.id or member.id = root.id
      left join public.jobs job on job.client_id = member.id
      left join public.candidate_associations association
        on association.job_id = job.id or association.client_id = member.id
      where normalized_search = ''
        or concat_ws(
          ' ',
          root.client_name,
          root.name,
          root.consultant_name,
          root.status,
          root.location,
          root.city,
          root.region
        ) ilike '%' || normalized_search || '%'
      group by root.id
    ),
    paged as (
      select * from rows
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged), '[]'::jsonb),
      'total', (select count(*) from rows),
      'offset', safe_offset,
      'limit', safe_limit
    ) into result;
  end if;

  return result;
end;
$$;

create or replace function public.admin_bulk_delete_preview(
  p_entity_type text,
  p_ids uuid[],
  p_delete_linked_candidate_rows boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ids uuid[];
  existing_ids uuid[];
  mandate_ids uuid[] := '{}'::uuid[];
  client_scope_ids uuid[] := '{}'::uuid[];
  association_ids uuid[] := '{}'::uuid[];
  selected_count integer := 0;
  candidate_count integer := 0;
  mandate_count integer := 0;
  client_count integer := 0;
  client_contact_count integer := 0;
  notification_count integer := 0;
  follow_up_count integer := 0;
  labels jsonb := '[]'::jsonb;
begin
  if p_entity_type not in ('candidate', 'mandate', 'client') then
    raise exception 'Invalid entity type' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Select at least one record' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct item), '{}'::uuid[])
  into ids
  from unnest(p_ids) item
  where item is not null;

  if cardinality(ids) = 0 then
    raise exception 'Select at least one valid record' using errcode = '22023';
  end if;

  if p_entity_type = 'candidate' then
    select coalesce(array_agg(id), '{}'::uuid[])
    into association_ids
    from public.candidate_associations
    where id = any(ids);

    select coalesce(array_agg(candidate.id), '{}'::uuid[])
    into existing_ids
    from public.candidates candidate
    where candidate.id = any(ids)
      and not exists (
        select 1 from public.candidate_associations association
        where association.candidate_id = candidate.id
      );

    existing_ids := association_ids || existing_ids;
    selected_count := cardinality(existing_ids);
    candidate_count := selected_count;

    select coalesce(jsonb_agg(jsonb_build_object('id', row_id, 'label', label)), '[]'::jsonb)
    into labels
    from (
      select association.id as row_id, candidate.full_name as label
      from public.candidate_associations association
      join public.candidates candidate on candidate.id = association.candidate_id
      where association.id = any(association_ids)
      union all
      select candidate.id, candidate.full_name
      from public.candidates candidate
      where candidate.id = any(existing_ids)
        and not exists (
          select 1 from public.candidate_associations association
          where association.candidate_id = candidate.id
        )
    ) selected;

    select count(*) into notification_count
    from public.notifications notification
    where notification.entity_id = any(existing_ids);
  elsif p_entity_type = 'mandate' then
    select
      coalesce(array_agg(job.id), '{}'::uuid[]),
      coalesce(jsonb_agg(jsonb_build_object('id', job.id, 'label', job.title)), '[]'::jsonb),
      count(*)::integer
    into mandate_ids, labels, mandate_count
    from public.jobs job
    where job.id = any(ids);

    existing_ids := mandate_ids;
    selected_count := mandate_count;

    select coalesce(array_agg(association.id), '{}'::uuid[]), count(*)::integer
    into association_ids, candidate_count
    from public.candidate_associations association
    where association.job_id = any(mandate_ids);

    select count(*) into notification_count
    from public.notifications notification
    where notification.mandate_id = any(mandate_ids)
       or notification.entity_id = any(mandate_ids)
       or notification.entity_id = any(association_ids);
  else
    select
      coalesce(array_agg(root.id), '{}'::uuid[]),
      coalesce(jsonb_agg(jsonb_build_object('id', root.id, 'label', coalesce(root.client_name, root.name))), '[]'::jsonb),
      count(*)::integer
    into existing_ids, labels, client_count
    from public.clients root
    where root.id = any(ids)
      and (root.client_group_id is null or root.client_group_id = root.id);

    selected_count := client_count;

    select coalesce(array_agg(member.id), '{}'::uuid[]), greatest(count(*)::integer - client_count, 0)
    into client_scope_ids, client_contact_count
    from public.clients member
    where member.id = any(existing_ids)
       or member.client_group_id = any(existing_ids);

    select coalesce(array_agg(job.id), '{}'::uuid[]), count(*)::integer
    into mandate_ids, mandate_count
    from public.jobs job
    where job.client_id = any(client_scope_ids);

    select coalesce(array_agg(association.id), '{}'::uuid[]), count(*)::integer
    into association_ids, candidate_count
    from public.candidate_associations association
    where association.job_id = any(mandate_ids)
       or association.client_id = any(client_scope_ids);

    select count(*) into notification_count
    from public.notifications notification
    where notification.client_id = any(client_scope_ids)
       or notification.mandate_id = any(mandate_ids)
       or notification.entity_id = any(client_scope_ids)
       or notification.entity_id = any(mandate_ids)
       or notification.entity_id = any(association_ids);

    select count(*) into follow_up_count
    from public.client_follow_ups follow_up
    where follow_up.client_id = any(client_scope_ids);
  end if;

  return jsonb_build_object(
    'entityType', p_entity_type,
    'selectedCount', selected_count,
    'missingCount', cardinality(ids) - selected_count,
    'selectedIds', existing_ids,
    'labels', labels,
    'clientsDeleted', case when p_entity_type = 'client' then client_count else 0 end,
    'clientContactsDeleted', client_contact_count,
    'clientsPreserved', case when p_entity_type = 'mandate' then (
      select count(distinct job.client_id) from public.jobs job where job.id = any(mandate_ids)
    ) else 0 end,
    'mandatesDeleted', case when p_entity_type in ('mandate', 'client') then mandate_count else 0 end,
    'candidateRowsAffected', candidate_count,
    'candidateRowsDeleted', case
      when p_entity_type = 'candidate' then candidate_count
      when p_delete_linked_candidate_rows then candidate_count
      else 0
    end,
    'candidateRowsRetained', case
      when p_entity_type <> 'candidate' and not p_delete_linked_candidate_rows then candidate_count
      else 0
    end,
    'notificationsDeleted', notification_count,
    'followUpsDeleted', follow_up_count,
    'resumeFilesPreserved', true,
    'idsRenumbered', false
  );
end;
$$;

create or replace function public.admin_bulk_delete_records(
  p_actor_user_id uuid,
  p_entity_type text,
  p_ids uuid[],
  p_delete_linked_candidate_rows boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preview jsonb;
  selected_ids uuid[];
  mandate_ids uuid[] := '{}'::uuid[];
  client_scope_ids uuid[] := '{}'::uuid[];
  association_ids uuid[] := '{}'::uuid[];
  candidate_master_ids uuid[] := '{}'::uuid[];
  batch_id uuid := gen_random_uuid();
  candidates_deleted integer := 0;
  candidates_retained integer := 0;
  mandates_deleted integer := 0;
  clients_deleted integer := 0;
  client_contacts_deleted integer := 0;
  notifications_deleted integer := 0;
  follow_ups_deleted integer := 0;
  deleted_now integer := 0;
begin
  if not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = p_actor_user_id
      and admin_user.role = 'super_admin'
  ) then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;

  preview := public.admin_bulk_delete_preview(
    p_entity_type,
    p_ids,
    coalesce(p_delete_linked_candidate_rows, false)
  );

  if (preview->>'missingCount')::integer > 0 then
    raise exception 'One or more selected records no longer exist. Refresh the list and try again.'
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into selected_ids
  from jsonb_array_elements_text(preview->'selectedIds');

  if p_entity_type = 'candidate' then
    select
      coalesce(array_agg(association.id), '{}'::uuid[]),
      coalesce(array_agg(distinct association.candidate_id), '{}'::uuid[])
    into association_ids, candidate_master_ids
    from public.candidate_associations association
    where association.id = any(selected_ids);

    delete from public.notifications notification
    where notification.entity_id = any(selected_ids);
    get diagnostics notifications_deleted = row_count;

    delete from public.candidate_associations association
    where association.id = any(association_ids);
    get diagnostics candidates_deleted = row_count;

    delete from public.candidates candidate
    where candidate.id = any(selected_ids)
      and not exists (
        select 1 from public.candidate_associations association
        where association.candidate_id = candidate.id
      );
    get diagnostics deleted_now = row_count;
    candidates_deleted := candidates_deleted + deleted_now;

    delete from public.candidates candidate
    where candidate.id = any(candidate_master_ids)
      and not exists (
        select 1 from public.candidate_associations association
        where association.candidate_id = candidate.id
      );
  elsif p_entity_type = 'mandate' then
    mandate_ids := selected_ids;
    select
      coalesce(array_agg(association.id), '{}'::uuid[]),
      coalesce(array_agg(distinct association.candidate_id), '{}'::uuid[])
    into association_ids, candidate_master_ids
    from public.candidate_associations association
    where association.job_id = any(mandate_ids);

    delete from public.notifications notification
    where notification.mandate_id = any(mandate_ids)
       or notification.entity_id = any(mandate_ids)
       or notification.entity_id = any(association_ids);
    get diagnostics notifications_deleted = row_count;

    if p_delete_linked_candidate_rows then
      delete from public.candidate_associations association
      where association.id = any(association_ids);
      get diagnostics candidates_deleted = row_count;
    else
      update public.candidate_associations association
      set job_id = null,
          job_title = null,
          updated_at = now()
      where association.id = any(association_ids);
      get diagnostics candidates_retained = row_count;
    end if;

    delete from public.jobs job
    where job.id = any(mandate_ids);
    get diagnostics mandates_deleted = row_count;

    if p_delete_linked_candidate_rows then
      delete from public.candidates candidate
      where candidate.id = any(candidate_master_ids)
        and not exists (
          select 1 from public.candidate_associations association
          where association.candidate_id = candidate.id
        );
    end if;
  else
    select coalesce(array_agg(member.id), '{}'::uuid[])
    into client_scope_ids
    from public.clients member
    where member.id = any(selected_ids)
       or member.client_group_id = any(selected_ids);

    select coalesce(array_agg(job.id), '{}'::uuid[])
    into mandate_ids
    from public.jobs job
    where job.client_id = any(client_scope_ids);

    select
      coalesce(array_agg(association.id), '{}'::uuid[]),
      coalesce(array_agg(distinct association.candidate_id), '{}'::uuid[])
    into association_ids, candidate_master_ids
    from public.candidate_associations association
    where association.job_id = any(mandate_ids)
       or association.client_id = any(client_scope_ids);

    delete from public.notifications notification
    where notification.client_id = any(client_scope_ids)
       or notification.mandate_id = any(mandate_ids)
       or notification.entity_id = any(client_scope_ids)
       or notification.entity_id = any(mandate_ids)
       or notification.entity_id = any(association_ids);
    get diagnostics notifications_deleted = row_count;

    delete from public.client_follow_ups follow_up
    where follow_up.client_id = any(client_scope_ids);
    get diagnostics follow_ups_deleted = row_count;

    if p_delete_linked_candidate_rows then
      delete from public.candidate_associations association
      where association.id = any(association_ids);
      get diagnostics candidates_deleted = row_count;
    else
      update public.candidate_associations association
      set client_id = null,
          client_name = null,
          job_id = null,
          job_title = null,
          updated_at = now()
      where association.id = any(association_ids);
      get diagnostics candidates_retained = row_count;
    end if;

    update public.candidates candidate
    set client_id = null,
        updated_at = now()
    where candidate.client_id = any(client_scope_ids);

    delete from public.jobs job
    where job.id = any(mandate_ids);
    get diagnostics mandates_deleted = row_count;

    delete from public.clients member
    where member.id = any(client_scope_ids)
      and member.id <> all(selected_ids);
    get diagnostics client_contacts_deleted = row_count;

    delete from public.clients root
    where root.id = any(selected_ids);
    get diagnostics clients_deleted = row_count;

    if p_delete_linked_candidate_rows then
      delete from public.candidates candidate
      where candidate.id = any(candidate_master_ids)
        and not exists (
          select 1 from public.candidate_associations association
          where association.candidate_id = candidate.id
        );
    end if;
  end if;

  insert into public.record_deletion_audit (
    batch_id,
    actor_user_id,
    entity_type,
    selected_ids,
    selected_labels,
    delete_linked_candidate_rows,
    candidates_deleted,
    candidates_retained,
    mandates_deleted,
    clients_deleted,
    client_contacts_deleted,
    dependent_records_deleted,
    status
  ) values (
    batch_id,
    p_actor_user_id,
    p_entity_type,
    selected_ids,
    preview->'labels',
    coalesce(p_delete_linked_candidate_rows, false),
    candidates_deleted,
    candidates_retained,
    mandates_deleted,
    clients_deleted,
    client_contacts_deleted,
    notifications_deleted + follow_ups_deleted,
    'success'
  );

  return jsonb_build_object(
    'batchId', batch_id,
    'entityType', p_entity_type,
    'candidatesDeleted', candidates_deleted,
    'candidatesRetained', candidates_retained,
    'mandatesDeleted', mandates_deleted,
    'clientsDeleted', clients_deleted,
    'clientContactsDeleted', client_contacts_deleted,
    'notificationsDeleted', notifications_deleted,
    'followUpsDeleted', follow_ups_deleted,
    'dependentRecordsDeleted', notifications_deleted + follow_ups_deleted,
    'resumeFilesPreserved', true,
    'idsRenumbered', false
  );
end;
$$;

revoke all on function public.admin_bulk_record_list(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_bulk_delete_preview(text, uuid[], boolean)
  from public, anon, authenticated;
revoke all on function public.admin_bulk_delete_records(uuid, text, uuid[], boolean)
  from public, anon, authenticated;

grant execute on function public.admin_bulk_record_list(text, text, integer, integer)
  to service_role;
grant execute on function public.admin_bulk_delete_preview(text, uuid[], boolean)
  to service_role;
grant execute on function public.admin_bulk_delete_records(uuid, text, uuid[], boolean)
  to service_role;
