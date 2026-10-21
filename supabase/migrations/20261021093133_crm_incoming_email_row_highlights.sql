-- Keep all activity unread counts/history; only incoming Gmail messages set row colour.
create or replace function public.crm_unread_activity(p_user uuid, p_clients uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with unread as (
    select a.* from public.crm_activities a
    where a.crm_client_id = any(p_clients)
      and not exists (select 1 from public.crm_activity_reads r where r.user_id=p_user and r.activity_id=a.id)
  ), grouped as (
    select crm_client_id, count(*) as unread_activity_count,
      (array_agg(
        case when email_metadata->'sentiment'->>'label' in ('positive','negative')
          then email_metadata->'sentiment'->>'label' else 'neutral' end
        order by created_at desc,id desc
      ) filter (where activity_type='gmail_email' and email_metadata->>'direction'='incoming'))[1] as unread_tone
    from unread group by crm_client_id
  )
  select coalesce(jsonb_object_agg(crm_client_id, jsonb_build_object(
    'unread_activity_count',unread_activity_count,'unread_tone',unread_tone)), '{}'::jsonb) from grouped;
$$;
revoke all on function public.crm_unread_activity(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.crm_unread_activity(uuid,uuid[]) to service_role;
