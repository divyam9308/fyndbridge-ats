-- Explicitly authorized ONE-TIME maintenance. Never called by application code.
-- Apply after protocol v2 migration, before enabling the new application worker.
-- Supabase applies this file transactionally and records it in migration history.
-- Lock the global worker, connections, imports, then jobs in that order. In-flight
-- commits either finish before these locks or fail their lease checks afterward.
do $$
declare emails jsonb; before_activities jsonb; before_connections jsonb; after_connections jsonb; permanent_jobs jsonb;
begin
  if to_regprocedure('public.crm_gmail_claim_worker_v2(uuid)') is null then raise exception 'Deploy contact-search protocol first'; end if;
  perform 1 from public.crm_gmail_worker where id for update;
  if exists(select 1 from public.crm_gmail_worker where id and contact_queue_cleaned_at is not null) then
    raise exception 'Contact queue cleanup already applied';
  end if;
  perform 1 from public.crm_gmail_connections order by id for update;
  perform 1 from public.crm_gmail_client_imports order by id for update;
  perform 1 from public.crm_gmail_jobs order by id for update;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into before_activities from public.crm_activities a;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'email',email,'credentials',credentials,'status',status,
    'connected_at',connected_at,'history_id',history_id,'page_token',page_token,'recovery_history_id',recovery_history_id,
    'recovery_since',recovery_since,'recovery_pages',recovery_pages,'last_sync_at',last_sync_at) order by id),'[]'::jsonb)
    into before_connections from public.crm_gmail_connections;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb) into permanent_jobs from public.crm_gmail_jobs j where status='permanent_failure';

  update public.crm_gmail_worker set lease_id=null,lease_until=null where id;
  update public.crm_gmail_connections set lease_id=null,lease_until=null;
  delete from public.crm_gmail_jobs j using public.crm_gmail_connections c
    where j.connection_id=c.id and c.status='connected' and j.status in ('pending','retryable_failure','processing');
  -- Remove only obsolete unfinished import cursors/snapshots for connected accounts.
  -- Completed requests and failed diagnostic records are retained.
  delete from public.crm_gmail_client_imports i using public.crm_gmail_connections c
    where i.connection_id=c.id and c.status='connected' and i.status in ('pending','processing');

  emails:=public.crm_gmail_valid_contacts();
  update public.crm_gmail_connections set backfill_page_token=null,contact_index=0,
    contact_snapshot=emails,contact_scan_id=gen_random_uuid(),backfill_started_at=now(),
    backfill_completed_at=case when jsonb_array_length(emails)=0 then now() else null end,
    next_attempt_at=now(),sync_attempts=0 where status='connected';
  -- Incremental history IDs, cursors, OAuth credentials and AI pauses are untouched.

  if exists(select 1 from public.crm_gmail_jobs j join public.crm_gmail_connections c on c.id=j.connection_id
    where c.status='connected' and j.status in ('pending','retryable_failure','processing')) then raise exception 'Obsolete queue remains'; end if;
  if before_activities is distinct from (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.crm_activities a) then raise exception 'Activity preservation failed'; end if;
  if permanent_jobs is distinct from (select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb) from public.crm_gmail_jobs j where status='permanent_failure') then raise exception 'Permanent diagnostics preservation failed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'email',email,'credentials',credentials,'status',status,
    'connected_at',connected_at,'history_id',history_id,'page_token',page_token,'recovery_history_id',recovery_history_id,
    'recovery_since',recovery_since,'recovery_pages',recovery_pages,'last_sync_at',last_sync_at) order by id),'[]'::jsonb)
    into after_connections from public.crm_gmail_connections;
  if before_connections is distinct from after_connections then raise exception 'Connection or checkpoint preservation failed'; end if;
  update public.crm_gmail_worker set contact_queue_cleaned_at=now() where id;
end $$;
