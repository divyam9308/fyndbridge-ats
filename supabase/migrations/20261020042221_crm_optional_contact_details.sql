-- Only organisation and contact-person names are required. Blank optional identities are not duplicates.
-- service-only (SECURITY INVOKER); payload cannot set audit identity/timestamps.
create or replace function public.crm_save(p_actor uuid, p_id uuid, p_version integer, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare old_row public.crm_clients; saved public.crm_clients; merged jsonb; contact jsonb;
  duplicate jsonb; field text; comment public.crm_comments; actor_active boolean;
begin
  select status<>'inactive' into actor_active from public.employee_statuses where user_id=p_actor::text for share;
  if actor_active is distinct from true then raise exception 'Active employee required' using errcode='42501'; end if;
  -- Locks serialize exact-name checks with ATS inserts/renames. They never mutate ATS data.
  if p_id is null or p_data ? 'organisation_name' then
    lock table public.clients in share row exclusive mode;
  end if;
  if p_id is not null then
    select * into old_row from public.crm_clients where id=p_id for update;
    if not found then raise exception 'CRM client not found' using errcode='P0002'; end if;
    if p_version is null or old_row.version<>p_version then raise exception 'This record changed. Reload the latest record before saving your changes.' using errcode='40001'; end if;
    merged := to_jsonb(old_row) || p_data;
  else
    merged := jsonb_build_object('assigned_consultant_id',p_actor) || p_data;
  end if;
  if coalesce(length(public.crm_normalize_name(merged->>'organisation_name')),0) not between 1 and 200 then raise exception 'Organisation Name is required (maximum 200 characters)'; end if;
  if jsonb_typeof(merged->'contacts') is distinct from 'array' then raise exception 'Add at least one contact'; end if;
  if jsonb_array_length(merged->'contacts') not between 1 and 50 then raise exception 'Add between 1 and 50 contacts'; end if;
  for contact in select value from jsonb_array_elements(merged->'contacts') loop
    if coalesce(length(btrim(contact->>'name')),0) not between 1 and 200 then raise exception 'Contact Person is required'; end if;
    -- Clients has no phone-format restriction; preserve free-form mobile values.
    if coalesce(length(btrim(contact->>'mobile')),0)>100 then raise exception 'Mobile must be at most 100 characters'; end if;
    if nullif(btrim(contact->>'email'),'') is not null and (btrim(contact->>'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(contact->>'email')>320) then raise exception 'Enter a valid contact email'; end if;
    if nullif(contact->>'linkedin','') is not null and (contact->>'linkedin' !~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^\s]*$') then raise exception 'Enter a valid HTTPS LinkedIn profile URL'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(merged->'contacts') c where nullif(btrim(c->>'email'),'') is not null group by public.crm_normalize_name(c->>'email') having count(*)>1)
    or exists (select 1 from jsonb_array_elements(merged->'contacts') c where nullif(btrim(c->>'mobile'),'') is not null group by regexp_replace(c->>'mobile','\s+','','g') having count(*)>1) then
    raise exception 'This contact person already exists for this client.';
  end if;
  if p_id is null or (merged->>'assigned_consultant_id') is distinct from old_row.assigned_consultant_id::text then
    if nullif(merged->>'assigned_consultant_id','') is not null then
      perform 1 from public.employee_statuses where user_id=merged->>'assigned_consultant_id' and status='active' for share;
      if not found then raise exception 'Only active consultants can receive assignments'; end if;
    end if;
  end if;
  if p_id is null or public.crm_normalize_name(merged->>'organisation_name') is distinct from old_row.name_key then
    duplicate := public.crm_duplicate(merged->>'organisation_name',p_id);
    if duplicate is not null and (duplicate->>'source'='crm' or (duplicate->>'id') is distinct from (merged->>'ats_client_id')) then
      raise exception 'Client already exists. Select the existing client or add a contact person under that client.' using errcode='23505', detail=duplicate::text;
    end if;
  end if;
  if p_id is null then
    insert into public.crm_clients(organisation_name,contacts,sector,connected_through,conversion_probability,status,assigned_consultant_id,ats_client_id,next_follow_up_date,created_by,updated_by)
    values(btrim(merged->>'organisation_name'),merged->'contacts',nullif(merged->>'sector',''),nullif(merged->>'connected_through',''),nullif(merged->>'conversion_probability',''),nullif(merged->>'status',''),nullif(merged->>'assigned_consultant_id','')::uuid,nullif(merged->>'ats_client_id','')::uuid,nullif(merged->>'next_follow_up_date','')::date,p_actor,p_actor) returning * into saved;
    insert into public.crm_activities(crm_client_id,activity_type,created_by) values(saved.id,'created',p_actor);
  else
    update public.crm_clients set organisation_name=btrim(merged->>'organisation_name'),contacts=merged->'contacts',sector=nullif(merged->>'sector',''),connected_through=nullif(merged->>'connected_through',''),conversion_probability=nullif(merged->>'conversion_probability',''),status=nullif(merged->>'status',''),assigned_consultant_id=nullif(merged->>'assigned_consultant_id','')::uuid,ats_client_id=nullif(merged->>'ats_client_id','')::uuid,next_follow_up_date=nullif(merged->>'next_follow_up_date','')::date,updated_at=clock_timestamp(),updated_by=p_actor,version=version+1 where id=p_id returning * into saved;
    foreach field in array array['organisation_name','contacts','sector','connected_through','conversion_probability','status','assigned_consultant_id','next_follow_up_date'] loop
      if (to_jsonb(old_row)->field) is distinct from (to_jsonb(saved)->field) then
        insert into public.crm_activities(crm_client_id,activity_type,previous_value,new_value,created_by)
        values(saved.id,field || '_changed',to_jsonb(old_row)->field,to_jsonb(saved)->field,p_actor);
      end if;
    end loop;
  end if;
  if nullif(btrim(p_data->>'comment'),'') is not null then
    insert into public.crm_comments(crm_client_id,body,created_by) values(saved.id,btrim(p_data->>'comment'),p_actor) returning * into comment;
    insert into public.crm_activities(crm_client_id,activity_type,comment_id,created_by) values(saved.id,'comment_added',comment.id,p_actor);
  end if;
  return to_jsonb(saved) || jsonb_build_object('latest_comment',(select to_jsonb(c) from public.crm_comments c where c.crm_client_id=saved.id order by c.created_at desc,c.id desc limit 1));
end;
$$;
revoke all on function public.crm_save(uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.crm_save(uuid,uuid,integer,jsonb) to service_role;
