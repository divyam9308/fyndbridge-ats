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
        candidate.candidate_display_id as display_id,
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
        candidate.candidate_display_id,
        candidate.full_name,
        candidate.email,
        candidate.mobile_number,
        null::text,
        coalesce(client.client_name, client.name),
        null::text,
        '-'::text,
        candidate.created_at
      from public.candidates candidate
      left join public.clients client on client.id = candidate.client_id
      where not exists (
        select 1
        from public.candidate_associations association
        where association.candidate_id = candidate.id
      )
    ),
    filtered as (
      select *
      from candidate_rows
      where normalized_search = ''
        or concat_ws(
          ' ',
          display_id,
          label,
          email,
          mobile_number,
          mandate,
          client,
          consultant,
          status
        ) ilike '%' || normalized_search || '%'
    ),
    paged as (
      select *
      from filtered
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce(
        (select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged),
        '[]'::jsonb
      ),
      'total', (select count(*) from filtered),
      'offset', safe_offset,
      'limit', safe_limit
    )
    into result;
  elsif p_entity_type = 'mandate' then
    with rows as (
      select
        job.id,
        job.job_display_id as display_id,
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
          job.job_display_id,
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
      select *
      from rows
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce(
        (select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged),
        '[]'::jsonb
      ),
      'total', (select count(*) from rows),
      'offset', safe_offset,
      'limit', safe_limit
    )
    into result;
  else
    with roots as (
      select client.*
      from public.clients client
      where client.client_group_id is null or client.client_group_id = client.id
    ),
    rows as (
      select
        root.id,
        root.client_display_id as display_id,
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
          root.client_display_id,
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
      select *
      from rows
      order by created_at desc, id
      offset safe_offset limit safe_limit
    )
    select jsonb_build_object(
      'data', coalesce(
        (select jsonb_agg(to_jsonb(paged) order by created_at desc, id) from paged),
        '[]'::jsonb
      ),
      'total', (select count(*) from rows),
      'offset', safe_offset,
      'limit', safe_limit
    )
    into result;
  end if;

  return result;
end;
$$;

revoke all on function public.admin_bulk_record_list(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_bulk_record_list(text, text, integer, integer)
  to service_role;
