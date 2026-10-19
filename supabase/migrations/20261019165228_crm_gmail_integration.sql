-- Gmail operations are service-role only. No changes to crm_save or CRM fields.
create table public.crm_gmail_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  browser_hash text not null,
  expected_email text not null,
  verifier_ciphertext text not null,
  consumed boolean not null default false,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index crm_gmail_oauth_expiry on public.crm_gmail_oauth_states(expires_at);
create table public.crm_gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  credentials text not null,
  status text not null default 'connected' check(status in ('connected','reauthorization_required')),
  connected_at timestamptz not null default now(),
  history_id text not null,
  page_token text,
  sync_requested boolean not null default false,
  next_attempt_at timestamptz not null default now(),
  sync_attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  last_sync_at timestamptz,
  last_error text,
  coverage_warning text,
  recovery_history_id text,
  recovery_since bigint,
  recovery_pages integer not null default 0
);
create index crm_gmail_sync_ready on public.crm_gmail_connections(next_attempt_at) where sync_requested;
create table public.crm_gmail_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_gmail_connections(id) on delete cascade,
  message_id text not null check(length(message_id) between 1 and 200),
  status text not null default 'pending' check(status in ('pending','processing','completed','retryable_failure','permanent_failure')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  outcome text,
  created_at timestamptz not null default now(),
  unique(connection_id,message_id)
);
create index crm_gmail_jobs_ready on public.crm_gmail_jobs(available_at,created_at) where status in ('pending','retryable_failure','processing');
create table public.crm_gmail_worker (
  id boolean primary key default true check(id),
  lease_id uuid,
  lease_until timestamptz,
  ai_resume_at timestamptz not null default now()
);
insert into public.crm_gmail_worker(id) values(true);
alter table public.crm_activities add column email_metadata jsonb;
alter table public.crm_activities add column gmail_user_id uuid;
alter table public.crm_activities add column gmail_message_id text;
create unique index crm_gmail_activity_dedup on public.crm_activities(gmail_user_id,gmail_message_id) where gmail_message_id is not null;
alter table public.crm_activities add constraint crm_gmail_activity_provenance check (
  (activity_type <> 'gmail_email' and email_metadata is null and gmail_user_id is null and gmail_message_id is null)
  or (activity_type = 'gmail_email' and email_metadata is not null and gmail_user_id is not null and gmail_message_id is not null)
);

create function public.crm_gmail_consume_state(p_hash text,p_browser text) returns jsonb
language sql security invoker set search_path = '' as $$
  update public.crm_gmail_oauth_states set consumed=true
  where state_hash=p_hash and browser_hash=p_browser and not consumed and expires_at>now()
  returning to_jsonb(crm_gmail_oauth_states.*);
$$;
create function public.crm_gmail_connect(p_hash text,p_user uuid,p_email text,p_credentials text,p_history text,p_connected_at timestamptz default now()) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 321));
  delete from public.crm_gmail_oauth_states where state_hash=p_hash and user_id=p_user and consumed and expires_at>now() and expected_email=p_email;
  if not found then raise exception 'OAuth transaction expired'; end if;
  -- A changed verified work address is a different mailbox with a new baseline.
  delete from public.crm_gmail_connections where user_id=p_user and email<>p_email;
  -- Reauthorization preserves the existing checkpoint, queued work and generation.
  insert into public.crm_gmail_connections(user_id,email,credentials,history_id,connected_at)
    values(p_user,p_email,p_credentials,p_history,p_connected_at)
    on conflict(user_id) do update set credentials=excluded.credentials,status='connected',last_error=null
    returning id into result;
  delete from public.crm_gmail_oauth_states where user_id=p_user;
  return result;
end $$;
create function public.crm_gmail_disconnect(p_user uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare secret text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 321));
  delete from public.crm_gmail_oauth_states where user_id=p_user;
  -- Cascade cancels ALL jobs. In-flight completions cannot commit after deletion.
  delete from public.crm_gmail_connections where user_id=p_user returning credentials into secret;
  return secret;
end $$;
create function public.crm_gmail_schedule() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.crm_gmail_connections set sync_requested=true where status='connected';
  delete from public.crm_gmail_oauth_states where expires_at<now();
end $$;
create function public.crm_gmail_claim_worker(p_lease uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with claimed as (update public.crm_gmail_worker set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    where id and (lease_until is null or lease_until<now()) returning id)
  select exists(select 1 from claimed);
$$;
create function public.crm_gmail_claim_sync(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select id from public.crm_gmail_connections where status='connected' and sync_requested
    and next_attempt_at<=now() and (lease_until is null or lease_until<now())
    order by next_attempt_at,id for update skip locked limit 1)
  update public.crm_gmail_connections c set lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where c.id=candidate.id returning to_jsonb(c.*);
$$;
-- Message IDs and pagination/checkpoint advancement commit in the SAME transaction.
create function public.crm_gmail_commit_page(p_id uuid,p_lease uuid,p_ids jsonb,p_history text,p_page text,p_recovery jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare connection public.crm_gmail_connections;
begin
  select * into connection from public.crm_gmail_connections where id=p_id and lease_id=p_lease and lease_until>now() for update;
  if not found then return false; end if;
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>5000 then raise exception 'Invalid discovery batch'; end if;
  insert into public.crm_gmail_jobs(connection_id,message_id) select p_id,value from jsonb_array_elements_text(p_ids)
    on conflict(connection_id,message_id) do nothing;
  update public.crm_gmail_connections set history_id=coalesce(p_history,history_id),page_token=p_page,
    recovery_history_id=p_recovery->>'history_id',recovery_since=(p_recovery->>'since')::bigint,
    recovery_pages=coalesce((p_recovery->>'pages')::integer,0),
    coverage_warning=coalesce(p_recovery->>'warning',coverage_warning),
    sync_requested=p_page is not null or (p_recovery->>'history_id') is not null,
    last_sync_at=case when p_page is null and (p_recovery->>'history_id') is null then now() else last_sync_at end,
    next_attempt_at=now(),sync_attempts=0,last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;
create function public.crm_gmail_claim_job(p_lease uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  with candidate as (select j.id from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.available_at<=now()
    and (j.status in ('pending','retryable_failure') or (j.status='processing' and j.lease_until<now()))
    and exists(select 1 from public.crm_gmail_worker where ai_resume_at<=now())
    order by j.available_at,j.created_at,j.id for update of j skip locked limit 1)
  update public.crm_gmail_jobs j set status='processing',attempts=attempts+1,lease_id=p_lease,lease_until=now()+interval '70 seconds'
    from candidate where j.id=candidate.id returning to_jsonb(j.*);
$$;
-- An expression index keeps exact matching efficient without changing contact
-- JSON, adding a second contact source, or modifying crm_save behaviour.
create function public.crm_gmail_contact_emails(p_contacts jsonb) returns text[]
language sql immutable strict security invoker set search_path = '' as $$
  select coalesce(array_agg(lower(btrim(contact->>'email'))),array[]::text[])
    from jsonb_array_elements(p_contacts) contact;
$$;
create index crm_gmail_contact_email_lookup on public.crm_clients using gin (public.crm_gmail_contact_emails(contacts));
create function public.crm_gmail_match_clients(p_peers jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'contacts',c.contacts)),'[]'::jsonb)
    from public.crm_clients c where public.crm_gmail_contact_emails(c.contacts) && array(select jsonb_array_elements_text(p_peers));
$$;
create function public.crm_gmail_finish_job(p_id uuid,p_lease uuid,p_client uuid,p_metadata jsonb,p_outcome text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare job public.crm_gmail_jobs; connection public.crm_gmail_connections; peers jsonb; matches jsonb;
begin
  -- Lock connection before job, matching disconnect's lock order.
  select c.* into connection from public.crm_gmail_connections c join public.crm_gmail_jobs j on j.connection_id=c.id where j.id=p_id for update of c;
  if not found or connection.status<>'connected' then return false; end if;
  select * into job from public.crm_gmail_jobs where id=p_id and status='processing' and lease_id=p_lease and lease_until>now() for update;
  if not found then return false; end if;
  if p_client is not null then
    peers := case when p_metadata->>'direction'='outgoing' then p_metadata->'recipients' else jsonb_build_array(p_metadata->>'sender') end;
    peers := (select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements_text(peers) where value<>connection.email);
    matches := public.crm_gmail_match_clients(peers);
    if jsonb_array_length(matches)<>1 or (matches->0->>'id')::uuid<>p_client then
      update public.crm_gmail_jobs set status='completed',outcome='contact_changed_or_ambiguous',lease_id=null,lease_until=null where id=p_id;
      return false;
    end if;
    insert into public.crm_activities(crm_client_id,activity_type,created_by,gmail_user_id,gmail_message_id,email_metadata)
      values(p_client,'gmail_email',connection.user_id,connection.user_id,job.message_id,p_metadata)
      on conflict(gmail_user_id,gmail_message_id) where gmail_message_id is not null do nothing;
  end if;
  update public.crm_gmail_jobs set status='completed',outcome=p_outcome,last_error=null,lease_id=null,lease_until=null where id=p_id;
  return true;
end $$;

-- Backend-only operational records and invoker RPCs. Browser roles have no grants
-- and no permissive policies; service-role explicitly retains required privileges.
do $$ declare tab text; fn record;
begin
  foreach tab in array array['crm_gmail_oauth_states','crm_gmail_connections','crm_gmail_jobs','crm_gmail_worker'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
  for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'crm_gmail_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
