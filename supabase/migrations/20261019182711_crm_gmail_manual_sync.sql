-- Manual sync is service-only and scoped to the authenticated caller by the API.
alter table public.crm_gmail_connections add column last_manual_sync_at timestamptz;

create function public.crm_gmail_request_manual_sync(p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare connection public.crm_gmail_connections;
begin
  select * into connection from public.crm_gmail_connections where user_id=p_user for update;
  if not found then return jsonb_build_object('state','not_connected'); end if;
  if connection.status<>'connected' then return jsonb_build_object('state','reauthorization_required'); end if;
  if connection.last_manual_sync_at > now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from connection.last_manual_sync_at+interval '30 seconds'-now()))::integer));
  end if;
  -- Never reset provider backoff or overwrite the work of an active discovery.
  update public.crm_gmail_connections set last_manual_sync_at=now(),sync_requested=true where id=connection.id;
  return jsonb_build_object('state',case when connection.lease_until>now() then 'in_progress' else 'requested' end);
end $$;

create function public.crm_gmail_claim_user_sync(p_lease uuid,p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where user_id=p_user
    and status='connected' and sync_requested and next_attempt_at<=now()
    and (lease_until is null or lease_until<now()) for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;

create function public.crm_gmail_claim_user_job(p_lease uuid,p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.user_id=p_user and c.status='connected' and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create function public.crm_gmail_manual_sync_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'connection', case when c.id is null then jsonb_build_object('connected',false) else
      jsonb_build_object('connected',true,'email',c.email,'status',c.status,'last_sync_at',c.last_sync_at,
        'last_error',c.last_error,'coverage_warning',c.coverage_warning) end,
    'discovery_pending',coalesce(c.sync_requested,false),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j where j.connection_id=c.id and j.status in ('pending','retryable_failure','processing')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs j where j.connection_id=c.id and j.status='permanent_failure'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now())
  ) from (select 1) singleton left join public.crm_gmail_connections c on c.user_id=p_user;
$$;

revoke all on function public.crm_gmail_request_manual_sync(uuid),public.crm_gmail_claim_user_sync(uuid,uuid),
  public.crm_gmail_claim_user_job(uuid,uuid),public.crm_gmail_manual_sync_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_gmail_request_manual_sync(uuid),public.crm_gmail_claim_user_sync(uuid,uuid),
  public.crm_gmail_claim_user_job(uuid,uuid),public.crm_gmail_manual_sync_status(uuid) to service_role;
