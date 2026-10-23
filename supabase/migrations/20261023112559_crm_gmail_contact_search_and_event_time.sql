-- Protocol v2: deploy before maintenance. Legacy workers cannot claim new work.
-- One current, validated address per bounded query; snapshots/cursors stay atomic.
alter table public.crm_gmail_worker add column contact_queue_cleaned_at timestamptz;
alter table public.crm_gmail_connections add column contact_snapshot jsonb,
  add column contact_index integer not null default 0 check(contact_index>=0),
  add column contact_scan_id uuid;
alter table public.crm_gmail_jobs add column discovery_kind text not null default 'incremental'
  check(discovery_kind in ('incremental','historical')),
  add column contact_scan_id uuid,
  add column discovery_contact_email text;

create function public.crm_gmail_valid_contacts(p_client uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from (
    select distinct lower(btrim(contact->>'email')) collate "C" email
    from public.crm_clients c cross join lateral jsonb_array_elements(c.contacts) contact
    where (p_client is null or c.id=p_client)
      and length(btrim(contact->>'email'))<=254
      and length(split_part(btrim(contact->>'email'),'@',1))<=64
      and lower(btrim(contact->>'email')) ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ) addresses;
$$;

create function public.crm_gmail_claim_worker_v2(p_lease uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with claimed as (update public.crm_gmail_worker set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    where id and (lease_until is null or lease_until<now()) returning id)
  select exists(select 1 from claimed);
$$;
create or replace function public.crm_gmail_claim_worker(p_lease uuid) returns boolean
language sql security invoker set search_path = '' as $$ select false; $$;
-- The old unrestricted commit API stays closed, even for an old execution with a new lease.
create or replace function public.crm_gmail_commit_backfill_page(p_id uuid,p_lease uuid,p_ids jsonb,p_page text) returns boolean
language sql security invoker set search_path = '' as $$ select false; $$;

create or replace function public.crm_gmail_request_manual_sync(p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare c public.crm_gmail_connections; emails jsonb;
begin
  select * into c from public.crm_gmail_connections where user_id=p_user for update;
  if not found then return jsonb_build_object('state','not_connected'); end if;
  if c.status<>'connected' then return jsonb_build_object('state','reauthorization_required'); end if;
  if c.last_manual_sync_at>now()-interval '30 seconds' then return jsonb_build_object('state','cooldown','retry_after',30); end if;
  emails:=public.crm_gmail_valid_contacts();
  update public.crm_gmail_connections set last_manual_sync_at=now(),sync_requested=true,
    backfill_started_at=case when c.backfill_completed_at is not null or c.contact_scan_id is null then now() else c.backfill_started_at end,
    backfill_completed_at=case when jsonb_array_length(emails)=0 then now() else null end,
    contact_snapshot=case when c.backfill_completed_at is not null or c.contact_scan_id is null then emails else c.contact_snapshot end,
    contact_index=case when c.backfill_completed_at is not null or c.contact_scan_id is null then 0 else c.contact_index end,
    backfill_page_token=case when c.backfill_completed_at is not null or c.contact_scan_id is null then null else c.backfill_page_token end,
    contact_scan_id=case when c.backfill_completed_at is not null or c.contact_scan_id is null then gen_random_uuid() else c.contact_scan_id end
    where id=c.id;
  return jsonb_build_object('state',case when jsonb_array_length(emails)=0 then 'no_contacts' else 'requested' end);
end $$;

create or replace function public.crm_gmail_request_all_sync(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare worker public.crm_gmail_worker; total integer; emails jsonb;
begin
  select * into worker from public.crm_gmail_worker where id for update;
  select count(*) into total from public.crm_gmail_connections where status='connected';
  if total=0 then return jsonb_build_object('state','not_connected'); end if;
  if worker.last_manual_sync_at>now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from worker.last_manual_sync_at+interval '30 seconds'-now()))::integer));
  end if;
  emails:=public.crm_gmail_valid_contacts();
  update public.crm_gmail_worker set last_manual_sync_at=now(),last_manual_sync_by=p_actor where id;
  update public.crm_gmail_connections c set sync_requested=true,
    backfill_started_at=case when c.backfill_completed_at is not null or c.contact_scan_id is null then now() else c.backfill_started_at end,
    backfill_completed_at=case when jsonb_array_length(emails)=0 then now() else null end,
    contact_snapshot=case when c.backfill_completed_at is not null or c.contact_scan_id is null then emails else c.contact_snapshot end,
    contact_index=case when c.backfill_completed_at is not null or c.contact_scan_id is null then 0 else c.contact_index end,
    backfill_page_token=case when c.backfill_completed_at is not null or c.contact_scan_id is null then null else c.backfill_page_token end,
    contact_scan_id=case when c.backfill_completed_at is not null or c.contact_scan_id is null then gen_random_uuid() else c.contact_scan_id end
    where c.status='connected';
  return jsonb_build_object('state',case when jsonb_array_length(emails)=0 then 'no_contacts' else 'requested' end,'connected_mailboxes',total);
end $$;

create or replace function public.crm_gmail_claim_sync(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where status='connected'
    and (sync_requested or (backfill_started_at is not null and backfill_completed_at is null))
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    and exists(select 1 from public.crm_gmail_worker where lease_id=p_lease and lease_until>now())
    order by next_attempt_at,id for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;
create or replace function public.crm_gmail_claim_user_sync(p_lease uuid,p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where user_id=p_user and status='connected'
    and (sync_requested or (backfill_started_at is not null and backfill_completed_at is null))
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    and exists(select 1 from public.crm_gmail_worker where lease_id=p_lease and lease_until>now()) for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;
create function public.crm_gmail_prepare_contact_scan(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare c public.crm_gmail_connections; emails jsonb;
begin
  select * into c from public.crm_gmail_connections where id=p_id and status='connected'
    and lease_id=p_lease and lease_until>now() for update;
  if not found then return null; end if;
  emails:=public.crm_gmail_valid_contacts();
  if c.contact_snapshot is distinct from emails or c.contact_scan_id is null then
    update public.crm_gmail_connections set contact_snapshot=emails,contact_index=0,backfill_page_token=null,
      contact_scan_id=gen_random_uuid() where id=p_id returning * into c;
  end if;
  if jsonb_array_length(emails)=0 or c.contact_index>=jsonb_array_length(emails) then
    update public.crm_gmail_connections set backfill_completed_at=now(),lease_id=null,lease_until=null where id=p_id;
    return null;
  end if;
  return jsonb_build_object('email',emails->>c.contact_index,'index',c.contact_index,'snapshot',c.contact_scan_id,'page',c.backfill_page_token,'before',c.backfill_started_at);
end $$;

create function public.crm_gmail_commit_contact_page(p_id uuid,p_lease uuid,p_snapshot uuid,p_index integer,p_ids jsonb,p_page text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare c public.crm_gmail_connections;
begin
  select * into c from public.crm_gmail_connections where id=p_id and status='connected'
    and lease_id=p_lease and lease_until>now() and contact_scan_id=p_snapshot and contact_index=p_index for update;
  if not found then return false; end if;
  if c.contact_snapshot is distinct from public.crm_gmail_valid_contacts() then
    update public.crm_gmail_connections set lease_id=null,lease_until=null where id=p_id;
    return false;
  end if;
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>500 then raise exception 'Invalid contact batch'; end if;
  insert into public.crm_gmail_jobs(connection_id,message_id,discovery_kind,contact_scan_id)
    select p_id,value,'historical',p_snapshot from jsonb_array_elements_text(p_ids)
    where not exists(select 1 from public.crm_activities a where a.gmail_user_id=c.user_id and a.gmail_message_id=value)
    on conflict(connection_id,message_id) do update set status='pending',outcome=null,last_error=null,attempts=0,
      available_at=now(),lease_id=null,lease_until=null,discovery_kind='historical',contact_scan_id=p_snapshot
      where crm_gmail_jobs.status='completed' and crm_gmail_jobs.contact_scan_id is distinct from p_snapshot
        and crm_gmail_jobs.outcome in ('before_connection','unrelated','ambiguous','contact_changed_or_ambiguous','historical_client_mismatch');
  update public.crm_gmail_connections set backfill_page_token=p_page,
    contact_index=contact_index+case when p_page is null then 1 else 0 end,
    backfill_completed_at=case when p_page is null and contact_index+1>=jsonb_array_length(contact_snapshot) then now() else null end,
    next_attempt_at=now(),sync_attempts=0,last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;

-- Client-scoped imports use the same current-contact snapshot rules.
create function public.crm_gmail_prepare_client_scan(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare task public.crm_gmail_client_imports; emails jsonb;
begin
  select * into task from public.crm_gmail_client_imports where id=p_id and status='processing' and lease_id=p_lease and lease_until>now() for update;
  if not found then return null; end if;
  emails:=public.crm_gmail_valid_contacts(task.crm_client_id);
  if jsonb_array_length(emails)=0 then
    update public.crm_gmail_client_imports set status='completed',page_token=null,lease_id=null,lease_until=null where id=p_id;
    return null;
  end if;
  if task.contact_emails is distinct from emails then
    update public.crm_gmail_client_imports set contact_emails=emails,contact_index=0,page_token=null where id=p_id returning * into task;
  end if;
  return jsonb_build_object('email',emails->>task.contact_index,'index',task.contact_index,'snapshot',emails,'page',task.page_token);
end $$;
create or replace function public.crm_gmail_commit_client_page(p_id uuid,p_lease uuid,p_ids jsonb,p_page text) returns boolean
language sql security invoker set search_path = '' as $$ select false; $$;
create function public.crm_gmail_commit_client_contact_page(p_id uuid,p_lease uuid,p_snapshot jsonb,p_index integer,p_ids jsonb,p_page text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare task public.crm_gmail_client_imports; owner_id uuid;
begin
  select c.user_id into owner_id from public.crm_gmail_connections c join public.crm_gmail_client_imports i on i.connection_id=c.id
    where i.id=p_id and c.status='connected' for update of c;
  if not found then return false; end if;
  select * into task from public.crm_gmail_client_imports where id=p_id and status='processing' and lease_id=p_lease and lease_until>now()
    and contact_emails=p_snapshot and contact_index=p_index for update;
  if not found then return false; end if;
  if p_snapshot is distinct from public.crm_gmail_valid_contacts(task.crm_client_id) then
    update public.crm_gmail_client_imports set status='pending',lease_id=null,lease_until=null where id=p_id;
    return false;
  end if;
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>500 then raise exception 'Invalid contact batch'; end if;
  insert into public.crm_gmail_jobs(connection_id,message_id,historical_client_id,discovery_kind,contact_scan_id,discovery_contact_email)
    select task.connection_id,value,task.crm_client_id,'historical',task.id,task.contact_emails->>p_index from jsonb_array_elements_text(p_ids)
    where not exists(select 1 from public.crm_activities a where a.gmail_user_id=owner_id and a.gmail_message_id=value)
    on conflict(connection_id,message_id) do update set status='pending',outcome=null,last_error=null,attempts=0,
      available_at=now(),lease_id=null,lease_until=null,discovery_kind='historical',historical_client_id=task.crm_client_id,contact_scan_id=task.id,discovery_contact_email=task.contact_emails->>p_index
      where crm_gmail_jobs.status='completed' and crm_gmail_jobs.outcome in ('before_connection','unrelated','ambiguous','contact_changed_or_ambiguous','historical_client_mismatch');
  update public.crm_gmail_client_imports set page_token=p_page,contact_index=contact_index+case when p_page is null then 1 else 0 end,
    status=case when p_page is null and contact_index+1>=jsonb_array_length(contact_emails) then 'completed' else 'pending' end,
    attempts=0,next_attempt_at=now(),last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;
-- Current exact ownership is authoritative, including contact transfers.
-- finish_job below revalidates every candidate against all organisations.
drop trigger crm_gmail_historical_client_check on public.crm_activities;
drop function public.crm_gmail_check_job_client();

-- Validate while holding a SHARE table lock: serializes concurrent contact edits,
-- including a new competing organisation, through the activity insert transaction.
create or replace function public.crm_gmail_finish_job(p_id uuid,p_lease uuid,p_client uuid,p_metadata jsonb,p_outcome text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare job public.crm_gmail_jobs; connection public.crm_gmail_connections; peers jsonb; matches jsonb; current_client uuid;
begin
  lock table public.crm_clients in share mode;
  select c.* into connection from public.crm_gmail_connections c join public.crm_gmail_jobs j on j.connection_id=c.id where j.id=p_id for update of c;
  if not found or connection.status<>'connected' then return false; end if;
  select * into job from public.crm_gmail_jobs where id=p_id and status='processing' and lease_id=p_lease and lease_until>now() for update;
  if not found then return false; end if;
  if p_client is not null then
    if p_metadata->>'direction' not in ('incoming','outgoing') or
      (p_metadata->>'direction'='outgoing' and p_metadata->>'sender'<>connection.email) or
      (p_metadata->>'direction'='incoming' and not (p_metadata->'recipients' ? connection.email)) then return false; end if;
    peers:=case when p_metadata->>'direction'='outgoing' then p_metadata->'recipients' else jsonb_build_array(p_metadata->>'sender') end;
    peers:=(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements_text(peers) where value<>connection.email);
    matches:=public.crm_gmail_match_clients(peers);
    if jsonb_array_length(matches)<>1 then
      update public.crm_gmail_jobs set status='completed',outcome='contact_changed_or_ambiguous',lease_id=null,lease_until=null where id=p_id;
      return false;
    end if;
    current_client:=(matches->0->>'id')::uuid;
    if job.historical_client_id is not null and (
      (job.discovery_contact_email is null and current_client<>job.historical_client_id) or
      (job.discovery_contact_email is not null and not (peers ? job.discovery_contact_email))) then
      update public.crm_gmail_jobs set status='completed',outcome='historical_client_mismatch',lease_id=null,lease_until=null where id=p_id;
      return false;
    end if;
    insert into public.crm_activities(crm_client_id,activity_type,created_by,gmail_user_id,gmail_message_id,email_metadata)
      values(current_client,'gmail_email',connection.user_id,connection.user_id,job.message_id,p_metadata)
      on conflict(gmail_user_id,gmail_message_id) where gmail_message_id is not null do nothing;
  end if;
  update public.crm_gmail_jobs set status='completed',outcome=p_outcome,last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;

-- All claims also require the active global lease. Revoked legacy executions
-- cannot steal fresh v2 jobs after the maintenance transaction.
create or replace function public.crm_gmail_claim_job(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now() and lease_id=p_lease and lease_until>now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create or replace function public.crm_gmail_claim_user_job(p_lease uuid,p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.user_id=p_user and c.status='connected' and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now() and lease_id=p_lease and lease_until>now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create or replace function public.crm_gmail_claim_client_job(p_lease uuid,p_client uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.historical_client_id=p_client and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now() and lease_id=p_lease and lease_until>now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create or replace function public.crm_gmail_claim_client_import(p_lease uuid,p_client uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select i.id from public.crm_gmail_client_imports i join public.crm_gmail_connections c on c.id=i.connection_id
    where c.status='connected' and exists(select 1 from public.crm_gmail_worker where lease_id=p_lease and lease_until>now()) and (p_client is null or i.crm_client_id=p_client) and i.next_attempt_at<=now()
    and (i.status='pending' or (i.status='processing' and i.lease_until<now()))
    order by i.next_attempt_at,i.id for update of i skip locked limit 1)
  update public.crm_gmail_client_imports i set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where i.id=candidate.id returning to_jsonb(i.*);
$$;

-- Preserve insertion/audit timestamps; order the timeline before pagination.
create function public.crm_gmail_saved_email_time(p_value text,p_fallback timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare result timestamptz;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return p_fallback; end if;
  result:=p_value::timestamptz;
  if not isfinite(result) then return p_fallback; end if;
  return result;
exception when invalid_datetime_format or datetime_field_overflow then return p_fallback;
end $$;
alter table public.crm_activities add column occurred_at timestamptz;
update public.crm_activities set occurred_at=case when activity_type='gmail_email'
  then public.crm_gmail_saved_email_time(email_metadata->>'email_at',created_at) else created_at end;
alter table public.crm_activities alter column occurred_at set not null;
create function public.crm_gmail_activity_time() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.occurred_at:=case when new.activity_type='gmail_email'
    then public.crm_gmail_saved_email_time(new.email_metadata->>'email_at',new.created_at) else new.created_at end;
  return new;
end $$;
create trigger crm_gmail_activity_time before insert or update of email_metadata,created_at,activity_type on public.crm_activities
  for each row execute function public.crm_gmail_activity_time();
create index crm_activities_event_timeline on public.crm_activities(crm_client_id,occurred_at desc,id desc);

create or replace function public.crm_gmail_all_sync_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('connection',case when c.id is null then jsonb_build_object('connected',false) else
    jsonb_build_object('connected',true,'email',c.email,'status',c.status,'last_sync_at',c.last_sync_at,'last_error',c.last_error,'coverage_warning',c.coverage_warning) end,
    'connected_mailboxes',(select count(*) from public.crm_gmail_connections where status='connected'),
    'no_contacts',jsonb_array_length(public.crm_gmail_valid_contacts())=0,
    'discovery_pending',exists(select 1 from public.crm_gmail_connections where status='connected' and (sync_requested or (backfill_started_at is not null and backfill_completed_at is null))),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j join public.crm_gmail_connections b on b.id=j.connection_id where b.status='connected' and j.status in ('pending','processing','retryable_failure')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs where status='permanent_failure'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now()))
  from (select 1) singleton left join public.crm_gmail_connections c on c.user_id=p_user;
$$;

do $$ declare fn record;
begin
  for fn in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'crm_gmail_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
