-- Optional incremental-only entry point. Full Sync now and maintenance retain
-- the resumable current-contact historical scan installed by protocol v2.
-- This migration performs no data cleanup and does not stop an active scan.

create or replace function public.crm_gmail_request_incremental_sync(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare worker public.crm_gmail_worker; total integer;
begin
  select * into worker from public.crm_gmail_worker where id for update;
  select count(*) into total from public.crm_gmail_connections where status='connected';
  if total=0 then return jsonb_build_object('state','not_connected'); end if;
  if worker.last_manual_sync_at>now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from worker.last_manual_sync_at+interval '30 seconds'-now()))::integer));
  end if;
  update public.crm_gmail_worker set last_manual_sync_at=now(),last_manual_sync_by=p_actor where id;
  update public.crm_gmail_connections set sync_requested=true where status='connected';
  return jsonb_build_object('state','requested','connected_mailboxes',total);
end $$;

create or replace function public.crm_gmail_claim_incremental_sync(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where status='connected' and sync_requested
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    and exists(select 1 from public.crm_gmail_worker where lease_id=p_lease and lease_until>now())
    order by next_attempt_at,id for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;

create or replace function public.crm_gmail_claim_incremental_job(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.historical_client_id is null and j.discovery_kind='incremental' and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now() and lease_id=p_lease and lease_until>now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create or replace function public.crm_gmail_incremental_sync_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('connection',case when c.id is null then jsonb_build_object('connected',false) else
    jsonb_build_object('connected',true,'email',c.email,'status',c.status,'last_sync_at',c.last_sync_at,'last_error',c.last_error,'coverage_warning',c.coverage_warning) end,
    'connected_mailboxes',(select count(*) from public.crm_gmail_connections where status='connected'),
    'discovery_pending',exists(select 1 from public.crm_gmail_connections where status='connected' and sync_requested),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j join public.crm_gmail_connections b on b.id=j.connection_id where b.status='connected' and j.historical_client_id is null and j.discovery_kind='incremental' and j.status in ('pending','processing','retryable_failure')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs where historical_client_id is null and discovery_kind='incremental' and status='permanent_failure'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now()))
  from (select 1) singleton left join public.crm_gmail_connections c on c.user_id=p_user;
$$;

revoke all on function public.crm_gmail_request_incremental_sync(uuid),public.crm_gmail_claim_incremental_sync(uuid),
  public.crm_gmail_claim_incremental_job(uuid),public.crm_gmail_incremental_sync_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_gmail_request_incremental_sync(uuid),public.crm_gmail_claim_incremental_sync(uuid),
  public.crm_gmail_claim_incremental_job(uuid),public.crm_gmail_incremental_sync_status(uuid) to service_role;
