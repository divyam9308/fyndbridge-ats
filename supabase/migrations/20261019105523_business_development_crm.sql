-- CRM is independent of ATS Clients. JSON contacts are an ordered, atomic group,
-- matching the Clients contact selector without allocating extra organisations.
create function public.crm_normalize_name(value text) returns text
language sql immutable strict set search_path = '' as $$
  select lower(translate(btrim(regexp_replace(value, '[\s\u00a0]+', ' ', 'g')), U&'\200B\200C\200D\FEFF\2060', ''));
$$;
revoke all on function public.crm_normalize_name(text) from public, anon, authenticated;
grant execute on function public.crm_normalize_name(text) to service_role;

create table public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  organisation_name text not null check (length(btrim(organisation_name)) between 1 and 200),
  name_key text generated always as (public.crm_normalize_name(organisation_name)) stored unique,
  contacts jsonb not null check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) between 1 and 50),
  sector text,
  connected_through text check (connected_through in ('LinkedIn','Referral','Cold Email','Cold Call','Existing Client','Other')),
  conversion_probability text check (conversion_probability in ('<25%','25-50%','50-75%','75-100%')),
  status text check (status in ('Outreach Sent','Follow-up Sent','DNP','CB','Meeting Scheduled','Proposal Sent','Negotiation','Won','Lost','On Hold','Not Interested','Nurture / Long-term')),
  assigned_consultant_id uuid references auth.users(id) on delete set null,
  ats_client_id uuid references public.clients(id) on delete set null,
  next_follow_up_date date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create table public.crm_comments (
  id uuid primary key default gen_random_uuid(),
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  activity_type text not null,
  previous_value jsonb,
  new_value jsonb,
  comment_id uuid references public.crm_comments(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index crm_clients_created_idx on public.crm_clients(created_at desc, id);
create index crm_clients_follow_up_idx on public.crm_clients(next_follow_up_date);
create index crm_comments_history_idx on public.crm_comments(crm_client_id, created_at desc, id desc);
create index crm_activities_history_idx on public.crm_activities(crm_client_id, created_at desc, id desc);
-- All reads and writes go through authenticated Express routes with the existing
-- page permission middleware. No browser role can bypass that permission gate.
alter table public.crm_clients enable row level security;
alter table public.crm_comments enable row level security;
alter table public.crm_activities enable row level security;
revoke all on public.crm_clients, public.crm_comments, public.crm_activities from public, anon, authenticated;
grant all on public.crm_clients, public.crm_comments, public.crm_activities to service_role;
insert into public.page_view_permissions(page_key, view_permission) values ('crm','everyone') on conflict do nothing;

create function public.crm_duplicate(p_name text, p_exclude uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('source','crm','id',c.id,'organisation_name',c.organisation_name,'contacts',c.contacts)
      from public.crm_clients c where c.name_key=public.crm_normalize_name(p_name) and c.id is distinct from p_exclude limit 1),
    (select jsonb_build_object('source','clients','id',c.id,'organisation_name',coalesce(c.client_name,c.name),
      'contacts',(select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(to_jsonb(cp)->>'contact_person',to_jsonb(cp)->>'contact'),'mobile',coalesce(to_jsonb(cp)->>'mobile',to_jsonb(cp)->>'phone'),'email',to_jsonb(cp)->>'email','designation',to_jsonb(cp)->>'designation','linkedin',to_jsonb(cp)->>'linkedin')) filter (where coalesce(to_jsonb(cp)->>'contact_person',to_jsonb(cp)->>'contact','')<>''),'[]'::jsonb) from public.clients cp where coalesce(cp.client_group_id,cp.id)=c.id))
      from public.clients c where (c.client_group_id is null or c.client_group_id=c.id)
        and public.crm_normalize_name(coalesce(c.client_name,c.name))=public.crm_normalize_name(p_name) limit 1));
$$;
revoke all on function public.crm_duplicate(text,uuid) from public, anon, authenticated;
grant execute on function public.crm_duplicate(text,uuid) to service_role;

-- Actor is supplied ONLY by the authenticated backend. Function execution is
-- service-only (SECURITY INVOKER); payload cannot set audit identity/timestamps.
create function public.crm_save(p_actor uuid, p_id uuid, p_version integer, p_data jsonb) returns jsonb
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
    if coalesce(length(btrim(contact->>'mobile')),0) not between 1 and 100 then raise exception 'Mobile is required'; end if;
    if coalesce(contact->>'email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(contact->>'email')>320 then raise exception 'Enter a valid contact email'; end if;
    if nullif(contact->>'linkedin','') is not null and (contact->>'linkedin' !~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^\s]*$') then raise exception 'Enter a valid HTTPS LinkedIn profile URL'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(merged->'contacts') c group by public.crm_normalize_name(c->>'email') having count(*)>1)
    or exists (select 1 from jsonb_array_elements(merged->'contacts') c group by regexp_replace(c->>'mobile','\s+','','g') having count(*)>1) then
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

create function public.crm_list(p_search text default '', p_follow_up text default 'all', p_today date default current_date, p_page integer default 1, p_size integer default 25, p_sort text default 'created_at', p_ascending boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; total integer;
begin
  with filtered as (
    select c.* from public.crm_clients c
    where (p_search='' or strpos(lower(concat_ws(' ',c.organisation_name,(select string_agg(concat_ws(' ',ct->>'name',ct->>'mobile',ct->>'email',ct->>'designation',ct->>'linkedin'),' ') from jsonb_array_elements(c.contacts) ct),c.sector,c.connected_through,c.status)),lower(p_search))>0)
      and case p_follow_up when 'overdue' then c.next_follow_up_date<p_today when 'today' then c.next_follow_up_date=p_today when 'upcoming' then c.next_follow_up_date>p_today when 'none' then c.next_follow_up_date is null else true end
  ), paged as (
    select * from filtered order by
      case when p_sort='organisation_name' and p_ascending then lower(organisation_name) end asc,
      case when p_sort='organisation_name' and not p_ascending then lower(organisation_name) end desc,
      case when p_sort='created_at' and p_ascending then created_at end asc,
      case when p_sort='created_at' and not p_ascending then created_at end desc,
      id offset ((greatest(p_page,1)-1)*least(greatest(p_size,1),100)) limit least(greatest(p_size,1),100)
  ) select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('latest_comment',(select to_jsonb(cm) from public.crm_comments cm where cm.crm_client_id=p.id order by cm.created_at desc,cm.id desc limit 1))),'[]'::jsonb), (select count(*) from filtered) into result,total from paged p;
  return jsonb_build_object('data',result,'total',total);
end;
$$;
revoke all on function public.crm_list(text,text,date,integer,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.crm_list(text,text,date,integer,integer,text,boolean) to service_role;
