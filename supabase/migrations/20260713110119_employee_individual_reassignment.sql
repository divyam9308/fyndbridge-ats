create or replace function public.employee_reassignment_records(
  p_employee_id text,
  p_category text,
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  source_name text;
  normalized_search text := btrim(coalesce(p_search, ''));
  category_total bigint := 0;
  filtered_total bigint := 0;
  records jsonb := '[]'::jsonb;
begin
  select btrim(profile.name) into source_name
  from public.user_profiles profile
  where profile.user_id = p_employee_id
    and nullif(btrim(profile.name), '') is not null;

  if source_name is null then
    raise exception 'Source employee not found' using errcode = 'P0002';
  end if;
  if p_category not in ('clients', 'mandates', 'candidates') then
    raise exception 'Invalid reassignment category' using errcode = '22023';
  end if;

  if p_category = 'clients' then
    select count(*) into category_total
    from public.clients client
    where client.consultant_user_id::text = p_employee_id
       or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name));

    select count(*) into filtered_total
    from public.clients client
    where (client.consultant_user_id::text = p_employee_id
       or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)))
      and (normalized_search = ''
        or coalesce(client.client_name, client.name, '') ilike '%' || normalized_search || '%'
        or coalesce(client.client_display_id, '') ilike '%' || normalized_search || '%');

    select coalesce(jsonb_agg(to_jsonb(item) order by lower(item.name), item.id), '[]'::jsonb) into records
    from (
      select client.id::text as id,
             coalesce(client.client_display_id, '') as display_id,
             coalesce(nullif(btrim(client.client_name), ''), nullif(btrim(client.name), ''), 'Unnamed client') as name,
             ''::text as secondary
      from public.clients client
      where (client.consultant_user_id::text = p_employee_id
         or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)))
        and (normalized_search = ''
          or coalesce(client.client_name, client.name, '') ilike '%' || normalized_search || '%'
          or coalesce(client.client_display_id, '') ilike '%' || normalized_search || '%')
      order by lower(coalesce(nullif(btrim(client.client_name), ''), nullif(btrim(client.name), ''), 'Unnamed client')), client.id
      limit greatest(1, least(coalesce(p_limit, 50), 100))
      offset greatest(coalesce(p_offset, 0), 0)
    ) item;
  elsif p_category = 'mandates' then
    select count(*) into category_total
    from public.jobs job
    where lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
       or exists (
         select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
         where lower(btrim(consultant)) = lower(source_name)
       );

    select count(*) into filtered_total
    from public.jobs job
    left join public.clients client on client.id = job.client_id
    where (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
       or exists (
         select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
         where lower(btrim(consultant)) = lower(source_name)
       ))
      and (normalized_search = ''
        or coalesce(job.title, '') ilike '%' || normalized_search || '%'
        or coalesce(job.job_display_id, '') ilike '%' || normalized_search || '%'
        or coalesce(client.client_name, client.name, '') ilike '%' || normalized_search || '%');

    select coalesce(jsonb_agg(to_jsonb(item) order by lower(item.name), item.id), '[]'::jsonb) into records
    from (
      select job.id::text as id,
             coalesce(job.job_display_id, '') as display_id,
             coalesce(nullif(btrim(job.title), ''), 'Unnamed mandate') as name,
             coalesce(nullif(btrim(client.client_name), ''), nullif(btrim(client.name), ''), '') as secondary
      from public.jobs job
      left join public.clients client on client.id = job.client_id
      where (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
         or exists (
           select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
           where lower(btrim(consultant)) = lower(source_name)
         ))
        and (normalized_search = ''
          or coalesce(job.title, '') ilike '%' || normalized_search || '%'
          or coalesce(job.job_display_id, '') ilike '%' || normalized_search || '%'
          or coalesce(client.client_name, client.name, '') ilike '%' || normalized_search || '%')
      order by lower(coalesce(nullif(btrim(job.title), ''), 'Unnamed mandate')), job.id
      limit greatest(1, least(coalesce(p_limit, 50), 100))
      offset greatest(coalesce(p_offset, 0), 0)
    ) item;
  else
    select count(*) into category_total
    from public.candidate_associations association
    where association.consultant_user_id::text = p_employee_id
       or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name));

    select count(*) into filtered_total
    from public.candidate_associations association
    join public.candidates candidate on candidate.id = association.candidate_id
    left join public.clients client on client.id = association.client_id
    left join public.jobs job on job.id = association.job_id
    where (association.consultant_user_id::text = p_employee_id
       or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)))
      and (normalized_search = ''
        or coalesce(candidate.full_name, '') ilike '%' || normalized_search || '%'
        or coalesce(candidate.candidate_display_id, '') ilike '%' || normalized_search || '%'
        or coalesce(client.client_name, client.name, association.client_name, '') ilike '%' || normalized_search || '%'
        or coalesce(job.title, association.job_title, '') ilike '%' || normalized_search || '%');

    select coalesce(jsonb_agg(to_jsonb(item) order by lower(item.name), item.id), '[]'::jsonb) into records
    from (
      select association.id::text as id,
             coalesce(candidate.candidate_display_id, '') as display_id,
             coalesce(nullif(btrim(candidate.full_name), ''), 'Unnamed candidate') as name,
             concat_ws(' · ',
               coalesce(nullif(btrim(client.client_name), ''), nullif(btrim(client.name), ''), nullif(btrim(association.client_name), '')),
               coalesce(nullif(btrim(job.title), ''), nullif(btrim(association.job_title), ''))
             ) as secondary
      from public.candidate_associations association
      join public.candidates candidate on candidate.id = association.candidate_id
      left join public.clients client on client.id = association.client_id
      left join public.jobs job on job.id = association.job_id
      where (association.consultant_user_id::text = p_employee_id
         or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)))
        and (normalized_search = ''
          or coalesce(candidate.full_name, '') ilike '%' || normalized_search || '%'
          or coalesce(candidate.candidate_display_id, '') ilike '%' || normalized_search || '%'
          or coalesce(client.client_name, client.name, association.client_name, '') ilike '%' || normalized_search || '%'
          or coalesce(job.title, association.job_title, '') ilike '%' || normalized_search || '%')
      order by lower(coalesce(nullif(btrim(candidate.full_name), ''), 'Unnamed candidate')), association.id
      limit greatest(1, least(coalesce(p_limit, 50), 100))
      offset greatest(coalesce(p_offset, 0), 0)
    ) item;
  end if;

  return jsonb_build_object(
    'category', p_category,
    'total', category_total,
    'filtered_total', filtered_total,
    'items', records
  );
end;
$$;

revoke all on function public.employee_reassignment_records(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.employee_reassignment_records(text, text, text, integer, integer) to service_role;

drop function if exists public.reassign_employee_assignments(uuid, text, text, text, text[]);

create or replace function public.reassign_employee_assignments(
  p_actor_id uuid,
  p_actor_email text,
  p_source_user_id text,
  p_destination_user_id text,
  p_selections jsonb
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
  client_mode text;
  mandate_mode text;
  candidate_mode text;
  client_selected uuid[] := '{}'::uuid[];
  client_excluded uuid[] := '{}'::uuid[];
  mandate_selected uuid[] := '{}'::uuid[];
  mandate_excluded uuid[] := '{}'::uuid[];
  candidate_selected uuid[] := '{}'::uuid[];
  candidate_excluded uuid[] := '{}'::uuid[];
  client_ids uuid[] := '{}'::uuid[];
  mandate_ids uuid[] := '{}'::uuid[];
  candidate_ids uuid[] := '{}'::uuid[];
  expected_count integer := 0;
  owned_count integer := 0;
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
  if p_selections is null or jsonb_typeof(p_selections) <> 'object' then
    raise exception 'Selections are required' using errcode = '22023';
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

  client_mode := coalesce(p_selections #>> '{clients,mode}', 'none');
  mandate_mode := coalesce(p_selections #>> '{mandates,mode}', 'none');
  candidate_mode := coalesce(p_selections #>> '{candidates,mode}', 'none');
  if client_mode not in ('none', 'selected', 'all')
     or mandate_mode not in ('none', 'selected', 'all')
     or candidate_mode not in ('none', 'selected', 'all') then
    raise exception 'Invalid selection mode' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_selections #> '{clients,selected_ids}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections #> '{clients,excluded_ids}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections #> '{mandates,selected_ids}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections #> '{mandates,excluded_ids}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections #> '{candidates,selected_ids}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_selections #> '{candidates,excluded_ids}', '[]'::jsonb)) <> 'array' then
    raise exception 'Selection IDs must be arrays' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into client_selected
  from jsonb_array_elements_text(coalesce(p_selections #> '{clients,selected_ids}', '[]'::jsonb)) value;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into client_excluded
  from jsonb_array_elements_text(coalesce(p_selections #> '{clients,excluded_ids}', '[]'::jsonb)) value;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into mandate_selected
  from jsonb_array_elements_text(coalesce(p_selections #> '{mandates,selected_ids}', '[]'::jsonb)) value;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into mandate_excluded
  from jsonb_array_elements_text(coalesce(p_selections #> '{mandates,excluded_ids}', '[]'::jsonb)) value;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into candidate_selected
  from jsonb_array_elements_text(coalesce(p_selections #> '{candidates,selected_ids}', '[]'::jsonb)) value;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into candidate_excluded
  from jsonb_array_elements_text(coalesce(p_selections #> '{candidates,excluded_ids}', '[]'::jsonb)) value;

  if (client_mode = 'none' and (cardinality(client_selected) > 0 or cardinality(client_excluded) > 0))
     or (client_mode = 'selected' and cardinality(client_excluded) > 0)
     or (client_mode = 'all' and cardinality(client_selected) > 0)
     or (mandate_mode = 'none' and (cardinality(mandate_selected) > 0 or cardinality(mandate_excluded) > 0))
     or (mandate_mode = 'selected' and cardinality(mandate_excluded) > 0)
     or (mandate_mode = 'all' and cardinality(mandate_selected) > 0)
     or (candidate_mode = 'none' and (cardinality(candidate_selected) > 0 or cardinality(candidate_excluded) > 0))
     or (candidate_mode = 'selected' and cardinality(candidate_excluded) > 0)
     or (candidate_mode = 'all' and cardinality(candidate_selected) > 0) then
    raise exception 'Selection IDs do not match their mode' using errcode = '22023';
  end if;

  if client_mode = 'selected' then
    client_ids := client_selected;
  elsif client_mode = 'all' then
    if cardinality(client_excluded) > 0 then
      select count(*) into owned_count
      from public.clients client
      where client.id = any(client_excluded)
        and (client.consultant_user_id::text = p_source_user_id
          or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)));
      if owned_count <> cardinality(client_excluded) then
        raise exception 'A client exclusion is no longer assigned to the source employee' using errcode = 'P0001';
      end if;
    end if;
    select coalesce(array_agg(client.id), '{}'::uuid[]) into client_ids
    from public.clients client
    where (client.consultant_user_id::text = p_source_user_id
       or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)))
      and not (client.id = any(client_excluded));
  end if;

  if mandate_mode = 'selected' then
    mandate_ids := mandate_selected;
  elsif mandate_mode = 'all' then
    if cardinality(mandate_excluded) > 0 then
      select count(*) into owned_count
      from public.jobs job
      where job.id = any(mandate_excluded)
        and (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
          or exists (
            select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
            where lower(btrim(consultant)) = lower(source_name)
          ));
      if owned_count <> cardinality(mandate_excluded) then
        raise exception 'A mandate exclusion is no longer assigned to the source employee' using errcode = 'P0001';
      end if;
    end if;
    select coalesce(array_agg(job.id), '{}'::uuid[]) into mandate_ids
    from public.jobs job
    where (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
       or exists (
         select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
         where lower(btrim(consultant)) = lower(source_name)
       ))
      and not (job.id = any(mandate_excluded));
  end if;

  if candidate_mode = 'selected' then
    candidate_ids := candidate_selected;
  elsif candidate_mode = 'all' then
    if cardinality(candidate_excluded) > 0 then
      select count(*) into owned_count
      from public.candidate_associations association
      where association.id = any(candidate_excluded)
        and (association.consultant_user_id::text = p_source_user_id
          or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)));
      if owned_count <> cardinality(candidate_excluded) then
        raise exception 'A candidate exclusion is no longer assigned to the source employee' using errcode = 'P0001';
      end if;
    end if;
    select coalesce(array_agg(association.id), '{}'::uuid[]) into candidate_ids
    from public.candidate_associations association
    where (association.consultant_user_id::text = p_source_user_id
       or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)))
      and not (association.id = any(candidate_excluded));
  end if;

  if cardinality(client_ids) + cardinality(mandate_ids) + cardinality(candidate_ids) = 0 then
    raise exception 'Select at least one currently assigned record' using errcode = '22023';
  end if;

  if cardinality(client_ids) > 0 then
    expected_count := cardinality(client_ids);
    select count(*) into owned_count
    from public.clients client
    where client.id = any(client_ids)
      and (client.consultant_user_id::text = p_source_user_id
        or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)));
    if owned_count <> expected_count then
      raise exception 'A selected client is no longer assigned to the source employee' using errcode = 'P0001';
    end if;
    with updated as (
      update public.clients client
      set consultant_user_id = p_destination_user_id::uuid,
          consultant_name = destination_name,
          updated_at = now()
      where client.id = any(client_ids)
        and (client.consultant_user_id::text = p_source_user_id
          or (client.consultant_user_id is null and lower(btrim(coalesce(client.consultant_name, ''))) = lower(source_name)))
      returning 1
    ) select count(*) into client_total from updated;
    if client_total <> expected_count then
      raise exception 'A client assignment changed during reassignment' using errcode = 'P0001';
    end if;
  end if;

  if cardinality(mandate_ids) > 0 then
    expected_count := cardinality(mandate_ids);
    select count(*) into owned_count
    from public.jobs job
    where job.id = any(mandate_ids)
      and (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
        or exists (
          select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
          where lower(btrim(consultant)) = lower(source_name)
        ));
    if owned_count <> expected_count then
      raise exception 'A selected mandate is no longer assigned to the source employee' using errcode = 'P0001';
    end if;
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
      where job.id = any(mandate_ids)
        and (lower(btrim(coalesce(job.team_lead, ''))) = lower(source_name)
          or exists (
            select 1 from unnest(coalesce(job.consultants, '{}'::text[])) consultant
            where lower(btrim(consultant)) = lower(source_name)
          ))
      returning 1
    ) select count(*) into mandate_total from updated;
    if mandate_total <> expected_count then
      raise exception 'A mandate assignment changed during reassignment' using errcode = 'P0001';
    end if;
  end if;

  if cardinality(candidate_ids) > 0 then
    expected_count := cardinality(candidate_ids);
    select count(*) into owned_count
    from public.candidate_associations association
    where association.id = any(candidate_ids)
      and (association.consultant_user_id::text = p_source_user_id
        or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)));
    if owned_count <> expected_count then
      raise exception 'A selected candidate is no longer assigned to the source employee' using errcode = 'P0001';
    end if;
    with updated as (
      update public.candidate_associations association
      set consultant_user_id = p_destination_user_id::uuid,
          consultant_name = destination_name,
          updated_at = now()
      where association.id = any(candidate_ids)
        and (association.consultant_user_id::text = p_source_user_id
          or (association.consultant_user_id is null and lower(btrim(coalesce(association.consultant_name, ''))) = lower(source_name)))
      returning 1
    ) select count(*) into candidate_total from updated;
    if candidate_total <> expected_count then
      raise exception 'A candidate assignment changed during reassignment' using errcode = 'P0001';
    end if;
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

revoke all on function public.reassign_employee_assignments(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.reassign_employee_assignments(uuid, text, text, text, jsonb) to service_role;
