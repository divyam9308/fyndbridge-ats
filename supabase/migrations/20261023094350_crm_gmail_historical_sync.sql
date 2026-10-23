-- Historical import is explicitly started by Sync now and resumes on the minute worker.
-- These columns inherit the connection table's service-only privileges and RLS.
alter table public.crm_gmail_connections
  add column backfill_started_at timestamptz,
  add column backfill_completed_at timestamptz,
  add column backfill_page_token text;

create or replace function public.crm_gmail_request_manual_sync(p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare connection public.crm_gmail_connections;
begin
  select * into connection from public.crm_gmail_connections where user_id=p_user for update;
  if not found then return jsonb_build_object('state','not_connected'); end if;
  if connection.status<>'connected' then return jsonb_build_object('state','reauthorization_required'); end if;
  if connection.last_manual_sync_at > now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from connection.last_manual_sync_at+interval '30 seconds'-now()))::integer));
  end if;
  -- Preserve active cursors. A later completed scan may run again for newly added contacts.
  update public.crm_gmail_connections set last_manual_sync_at=now(),sync_requested=true,
    backfill_started_at=case when backfill_completed_at is not null then now() else coalesce(backfill_started_at,now()) end,
    backfill_page_token=case when backfill_completed_at is not null then null else backfill_page_token end,
    backfill_completed_at=null where id=connection.id;
  return jsonb_build_object('state',case when connection.lease_until>now() then 'in_progress' else 'requested' end);
end $$;

create or replace function public.crm_gmail_claim_sync(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where status='connected'
    and (sync_requested or (backfill_started_at is not null and backfill_completed_at is null))
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    order by next_attempt_at,id for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;

create or replace function public.crm_gmail_claim_user_sync(p_lease uuid,p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where user_id=p_user and status='connected'
    and (sync_requested or (backfill_started_at is not null and backfill_completed_at is null))
    and next_attempt_at<=now() and (lease_until is null or lease_until<now()) for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;

-- Enqueuing a page and saving its cursor are atomic and fenced by the connection lease.
create function public.crm_gmail_commit_backfill_page(p_id uuid,p_lease uuid,p_ids jsonb,p_page text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare connection public.crm_gmail_connections;
begin
  select * into connection from public.crm_gmail_connections where id=p_id and status='connected'
    and lease_id=p_lease and lease_until>now() and backfill_started_at is not null
    and backfill_completed_at is null for update;
  if not found then return false; end if;
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>500 then
    raise exception 'Invalid historical discovery batch';
  end if;
  insert into public.crm_gmail_jobs(connection_id,message_id)
    select p_id,value from jsonb_array_elements_text(p_ids)
    on conflict(connection_id,message_id) do update
      set status='pending',outcome=null,last_error=null,attempts=0,available_at=now(),lease_id=null,lease_until=null
      where crm_gmail_jobs.status='completed'
        and crm_gmail_jobs.outcome in ('before_connection','unrelated','ambiguous','contact_changed_or_ambiguous');
  update public.crm_gmail_connections set backfill_page_token=p_page,
    backfill_completed_at=case when p_page is null then now() else null end,
    next_attempt_at=now(),sync_attempts=0,last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;

create or replace function public.crm_gmail_manual_sync_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'connection', case when c.id is null then jsonb_build_object('connected',false) else
      jsonb_build_object('connected',true,'email',c.email,'status',c.status,'last_sync_at',c.last_sync_at,
        'last_error',c.last_error,'coverage_warning',c.coverage_warning,
        'backfill_started_at',c.backfill_started_at,'backfill_completed_at',c.backfill_completed_at) end,
    'discovery_pending',coalesce(c.sync_requested,false),
    'backfill_pending',coalesce(c.backfill_started_at is not null and c.backfill_completed_at is null,false),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j where j.connection_id=c.id and j.status in ('pending','retryable_failure','processing')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs j where j.connection_id=c.id and j.status='permanent_failure'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now())
  ) from (select 1) singleton left join public.crm_gmail_connections c on c.user_id=p_user;
$$;

revoke all on function public.crm_gmail_request_manual_sync(uuid), public.crm_gmail_claim_sync(uuid),
  public.crm_gmail_claim_user_sync(uuid,uuid), public.crm_gmail_commit_backfill_page(uuid,uuid,jsonb,text),
  public.crm_gmail_manual_sync_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_gmail_request_manual_sync(uuid), public.crm_gmail_claim_sync(uuid),
  public.crm_gmail_claim_user_sync(uuid,uuid), public.crm_gmail_commit_backfill_page(uuid,uuid,jsonb,text),
  public.crm_gmail_manual_sync_status(uuid) to service_role;

-- Existing AI minute-limit pauses must not retain their previous 24-hour delay.
update public.crm_gmail_worker set ai_resume_at=least(ai_resume_at,now()+interval '1 minute');
update public.crm_gmail_jobs set available_at=least(available_at,now()+interval '1 minute')
  where status='retryable_failure' and last_error='QUOTA_PAUSED';
