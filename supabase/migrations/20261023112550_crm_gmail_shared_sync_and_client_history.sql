-- New mail is shared; historical imports require an explicit CRM client selection.
alter table public.crm_gmail_worker add column last_manual_sync_at timestamptz,
  add column last_manual_sync_by uuid references auth.users(id) on delete set null;
alter table public.crm_gmail_jobs add column historical_client_id uuid references public.crm_clients(id) on delete cascade;

create table public.crm_gmail_client_imports (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_gmail_connections(id) on delete cascade,
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  scan_before timestamptz not null default now(),
  contact_emails jsonb not null check(jsonb_typeof(contact_emails)='array' and jsonb_array_length(contact_emails)>0),
  contact_index integer not null default 0 check(contact_index>=0),
  page_token text,
  status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  lease_id uuid,
  lease_until timestamptz,
  unique(connection_id,crm_client_id)
);
create index crm_gmail_client_imports_ready on public.crm_gmail_client_imports(next_attempt_at) where status in ('pending','processing');
create index crm_gmail_historical_jobs on public.crm_gmail_jobs(historical_client_id,status,available_at);
alter table public.crm_gmail_client_imports enable row level security;
revoke all on public.crm_gmail_client_imports from public,anon,authenticated;
grant all on public.crm_gmail_client_imports to service_role;

-- Stop the previous automatic, mailbox-wide historical scans. Existing history is retained.
update public.crm_gmail_connections set backfill_completed_at=now()
  where backfill_started_at is not null and backfill_completed_at is null;

create or replace function public.crm_gmail_request_manual_sync(p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare connection public.crm_gmail_connections;
begin
  select * into connection from public.crm_gmail_connections where user_id=p_user for update;
  if not found then return jsonb_build_object('state','not_connected'); end if;
  if connection.status<>'connected' then return jsonb_build_object('state','reauthorization_required'); end if;
  if connection.last_manual_sync_at>now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from connection.last_manual_sync_at+interval '30 seconds'-now()))::integer));
  end if;
  update public.crm_gmail_connections set last_manual_sync_at=now(),sync_requested=true where id=connection.id;
  return jsonb_build_object('state','requested');
end $$;

create function public.crm_gmail_request_all_sync(p_actor uuid) returns jsonb
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

create or replace function public.crm_gmail_claim_sync(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where status='connected' and sync_requested
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    order by next_attempt_at,id for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;

create function public.crm_gmail_claim_incremental_job(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.historical_client_id is null and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create function public.crm_gmail_request_client_import(p_actor uuid,p_client uuid,p_emails jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare requested timestamptz; total integer;
begin
  perform 1 from public.crm_clients where id=p_client for update;
  if not found then return jsonb_build_object('state','client_not_found'); end if;
  if jsonb_typeof(p_emails) is distinct from 'array' or jsonb_array_length(p_emails)=0 or jsonb_array_length(p_emails)>100 then raise exception 'Invalid client emails'; end if;
  select max(requested_at) into requested from public.crm_gmail_client_imports where crm_client_id=p_client;
  if requested>now()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_after',greatest(1,ceil(extract(epoch from requested+interval '30 seconds'-now()))::integer));
  end if;
  insert into public.crm_gmail_client_imports(connection_id,crm_client_id,requested_by,contact_emails)
    select id,p_client,p_actor,p_emails from public.crm_gmail_connections where status='connected'
    on conflict(connection_id,crm_client_id) do update set requested_by=p_actor,requested_at=now(),
      scan_before=case when crm_gmail_client_imports.status in ('completed','failed') then now() else crm_gmail_client_imports.scan_before end,
      contact_emails=case when crm_gmail_client_imports.status in ('completed','failed') then p_emails else crm_gmail_client_imports.contact_emails end,
      contact_index=case when crm_gmail_client_imports.status in ('completed','failed') then 0 else crm_gmail_client_imports.contact_index end,
      page_token=case when crm_gmail_client_imports.status in ('completed','failed') then null else crm_gmail_client_imports.page_token end,
      next_attempt_at=case when crm_gmail_client_imports.status in ('completed','failed') then now() else crm_gmail_client_imports.next_attempt_at end,
      attempts=case when crm_gmail_client_imports.status in ('completed','failed') then 0 else crm_gmail_client_imports.attempts end,
      status=case when crm_gmail_client_imports.status in ('completed','failed') then 'pending' else crm_gmail_client_imports.status end;
  get diagnostics total=row_count;
  return jsonb_build_object('state',case when total=0 then 'not_connected' else 'requested' end,'connected_mailboxes',total);
end $$;

create function public.crm_gmail_claim_client_import(p_lease uuid,p_client uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select i.id from public.crm_gmail_client_imports i join public.crm_gmail_connections c on c.id=i.connection_id
    where c.status='connected' and (p_client is null or i.crm_client_id=p_client) and i.next_attempt_at<=now()
    and (i.status='pending' or (i.status='processing' and i.lease_until<now()))
    order by i.next_attempt_at,i.id for update of i skip locked limit 1)
  update public.crm_gmail_client_imports i set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where i.id=candidate.id returning to_jsonb(i.*);
$$;

create function public.crm_gmail_commit_client_page(p_id uuid,p_lease uuid,p_ids jsonb,p_page text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare task public.crm_gmail_client_imports; advance boolean;
begin
  -- Match disconnect's lock order: connection before its import/job records.
  perform 1 from public.crm_gmail_connections c join public.crm_gmail_client_imports i on i.connection_id=c.id
    where i.id=p_id and c.status='connected' for update of c;
  if not found then return false; end if;
  select * into task from public.crm_gmail_client_imports where id=p_id and status='processing'
    and lease_id=p_lease and lease_until>now() for update;
  if not found then return false; end if;
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>500 then raise exception 'Invalid discovery batch'; end if;
  insert into public.crm_gmail_jobs(connection_id,message_id,historical_client_id)
    select task.connection_id,value,task.crm_client_id from jsonb_array_elements_text(p_ids)
    on conflict(connection_id,message_id) do update set historical_client_id=task.crm_client_id,status='pending',
      outcome=null,last_error=null,attempts=0,available_at=now(),lease_id=null,lease_until=null
      where (crm_gmail_jobs.status in ('completed','retryable_failure','permanent_failure') and crm_gmail_jobs.outcome is distinct from 'activity_created')
        or (crm_gmail_jobs.status='pending' and crm_gmail_jobs.historical_client_id is null);
  advance:=p_page is null;
  update public.crm_gmail_client_imports set page_token=p_page,
    contact_index=contact_index+case when advance then 1 else 0 end,
    status=case when advance and contact_index+1>=jsonb_array_length(contact_emails) then 'completed' else 'pending' end,
    attempts=0,next_attempt_at=now(),last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;

create function public.crm_gmail_claim_client_job(p_lease uuid,p_client uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.historical_client_id=p_client and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;

create function public.crm_gmail_all_sync_status(p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('connection',case when c.id is null then jsonb_build_object('connected',false) else
    jsonb_build_object('connected',true,'email',c.email,'status',c.status,'last_sync_at',c.last_sync_at,'last_error',c.last_error,'coverage_warning',c.coverage_warning) end,
    'connected_mailboxes',(select count(*) from public.crm_gmail_connections where status='connected'),
    'discovery_pending',exists(select 1 from public.crm_gmail_connections where status='connected' and sync_requested),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j join public.crm_gmail_connections b on b.id=j.connection_id where b.status='connected' and j.historical_client_id is null and j.status in ('pending','processing','retryable_failure')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs where historical_client_id is null and status='permanent_failure'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now()))
  from (select 1) singleton left join public.crm_gmail_connections c on c.user_id=p_user;
$$;

create function public.crm_gmail_client_import_status(p_client uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('client_id',p_client,
    'connected_mailboxes',(select count(*) from public.crm_gmail_client_imports i join public.crm_gmail_connections c on c.id=i.connection_id where i.crm_client_id=p_client and c.status='connected'),
    'discovery_pending',exists(select 1 from public.crm_gmail_client_imports i join public.crm_gmail_connections c on c.id=i.connection_id where i.crm_client_id=p_client and c.status='connected' and i.status in ('pending','processing')),
    'pending_jobs',(select count(*) from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id where c.status='connected' and j.historical_client_id=p_client and j.status in ('pending','processing','retryable_failure')),
    'failed_jobs',(select count(*) from public.crm_gmail_jobs where historical_client_id=p_client and status='permanent_failure')+(select count(*) from public.crm_gmail_client_imports where crm_client_id=p_client and status='failed'),
    'ai_paused',exists(select 1 from public.crm_gmail_worker where ai_resume_at>now()));
$$;

-- Enforce the selected client again at the database write boundary.
create function public.crm_gmail_check_job_client() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.activity_type='gmail_email' and exists(select 1 from public.crm_gmail_jobs j
    join public.crm_gmail_connections c on c.id=j.connection_id
    where c.user_id=new.gmail_user_id and j.message_id=new.gmail_message_id
      and j.historical_client_id is not null and j.historical_client_id<>new.crm_client_id) then
    raise exception 'Historical email client does not match requested client';
  end if;
  return new;
end $$;
create trigger crm_gmail_historical_client_check before insert on public.crm_activities
  for each row execute function public.crm_gmail_check_job_client();

do $$ declare fn record;
begin
  for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in (
    'crm_gmail_request_all_sync','crm_gmail_claim_incremental_job','crm_gmail_request_client_import',
    'crm_gmail_claim_client_import','crm_gmail_commit_client_page','crm_gmail_claim_client_job',
    'crm_gmail_all_sync_status','crm_gmail_client_import_status','crm_gmail_check_job_client') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
