-- Read receipts belong to a viewer, never to the shared client record.
create table public.crm_activity_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.crm_activities(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, activity_id)
);
create index crm_activity_reads_activity_idx on public.crm_activity_reads(activity_id);
alter table public.crm_activity_reads enable row level security;
revoke all on public.crm_activity_reads from public, anon, authenticated, service_role;
grant select, insert on public.crm_activity_reads to service_role;

-- Express supplies the authenticated viewer and only the current page's clients.
create function public.crm_unread_activity(p_user uuid, p_clients uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with unread as (
    select a.* from public.crm_activities a
    where a.crm_client_id = any(p_clients)
      and not exists (select 1 from public.crm_activity_reads r where r.user_id=p_user and r.activity_id=a.id)
  ), grouped as (
    select crm_client_id, count(*) as unread_activity_count,
      coalesce((array_agg(
        case when email_metadata->'sentiment'->>'label' in ('positive','negative')
          then email_metadata->'sentiment'->>'label' else 'neutral' end
        order by created_at desc,id desc
      ) filter (where activity_type='gmail_email'))[1], 'positive') as unread_tone
    from unread group by crm_client_id
  )
  select coalesce(jsonb_object_agg(crm_client_id, jsonb_build_object(
    'unread_activity_count',unread_activity_count,'unread_tone',unread_tone)), '{}'::jsonb) from grouped;
$$;

-- Exact activity IDs avoid acknowledging emails that arrive while history loads.
-- NULL client + NULL IDs is the explicit, atomic "Read all" operation.
create function public.crm_mark_activity_read(p_user uuid, p_client uuid, p_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare marked integer;
begin
  if p_user is null or (p_client is null) <> (p_ids is null)
    or (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>25)) then
    raise exception 'Invalid CRM read request.';
  end if;
  with inserted as (
    insert into public.crm_activity_reads(user_id,activity_id)
    select p_user,a.id from public.crm_activities a
    where (p_client is null or a.crm_client_id=p_client)
      and (p_ids is null or a.id=any(p_ids))
    on conflict (user_id,activity_id) do nothing returning activity_id
  ) select count(*) into marked from inserted;
  return marked;
end;
$$;
revoke all on function public.crm_unread_activity(uuid,uuid[]), public.crm_mark_activity_read(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.crm_unread_activity(uuid,uuid[]), public.crm_mark_activity_read(uuid,uuid,uuid[]) to service_role;
