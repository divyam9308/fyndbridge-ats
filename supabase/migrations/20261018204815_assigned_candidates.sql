-- Preliminary records never allocate a CA ID or enter candidate analytics.
grant usage on schema private to service_role;
create table public.assigned_candidate_uploads (
  id uuid primary key,
  uploaded_by uuid not null references auth.users(id),
  cv_storage_path text not null unique,
  cv_original_name text not null,
  cv_mimetype text not null,
  cv_file_hash text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  parsed_name text,
  parsed_mobile text,
  parse_error text,
  storage_ready boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  retired_at timestamptz,
  cleanup_claimed_at timestamptz
);
create table public.assigned_candidates (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null unique references public.assigned_candidate_uploads(id),
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  mobile_number text not null check (mobile_number = '-' or mobile_number ~ '^\+?[0-9]{7,15}$'),
  client_id uuid references public.clients(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  assigned_consultant_id uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  status text not null default 'Not Contacted' check (status in (
    'Not Contacted', 'Didn’t Pick Up', 'Interested', 'In Discussion', 'Not Interested', 'Interview',
    'Client Submission', 'Offered', 'Hired', 'Offer Declined', 'Dropout', 'Rejected by Recruiter', 'Rejected by Client'
  )),
  assigned_at timestamptz not null default now(),
  contacted_at timestamptz,
  added_at timestamptz,
  candidate_id uuid references public.candidates(id) on delete set null,
  association_id uuid references public.candidate_associations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sort_group integer generated always as (case when added_at is not null then 2 when status = 'Not Contacted' then 0 when status = 'Didn’t Pick Up' then 1 else 2 end) stored
);
create index assigned_candidates_scope_order_idx on public.assigned_candidates(assigned_consultant_id, sort_group, assigned_at, id);
create index assigned_candidates_overall_order_idx on public.assigned_candidates(sort_group, assigned_at, id);
create index assigned_candidates_pending_idx on public.assigned_candidates(assigned_consultant_id) where status = 'Not Contacted';
create index assigned_candidates_candidate_idx on public.assigned_candidates(candidate_id) where candidate_id is not null;
create index assigned_candidates_client_idx on public.assigned_candidates(client_id);
create index assigned_candidates_job_idx on public.assigned_candidates(job_id);
create index assigned_candidates_association_idx on public.assigned_candidates(association_id);
create index assigned_uploads_owner_idx on public.assigned_candidate_uploads(uploaded_by);
create index assigned_uploads_expiry_idx on public.assigned_candidate_uploads(expires_at);
create index assigned_uploads_retired_idx on public.assigned_candidate_uploads(retired_at) where retired_at is not null;

alter table public.candidate_associations add column assigned_candidate_id uuid references public.assigned_candidates(id) on delete set null;
create unique index candidate_associations_assignment_idx on public.candidate_associations(assigned_candidate_id) where assigned_candidate_id is not null;

create or replace function private.assigned_candidates_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (select private.is_current_employee_active()) and exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
      or lower(a.email) = lower((select auth.jwt())->>'email')
  );
$$;
create or replace function private.assigned_candidates_access() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (select private.is_current_employee_active()) and coalesce((
    select case p.view_permission when 'everyone' then true
      when 'admin_only' then private.assigned_candidates_admin()
      when 'super_admin_only' then private.assigned_candidates_admin() and exists (
        select 1 from public.admin_users a where (a.user_id = auth.uid() or lower(a.email) = lower(auth.jwt()->>'email'))
          and (a.role = 'super_admin' or a.is_super_admin)
      ) else false end
    from public.page_view_permissions p where p.page_key = 'assigned_candidates'
  ), true);
$$;
revoke all on function private.assigned_candidates_admin(), private.assigned_candidates_access() from public, anon;
grant execute on function private.assigned_candidates_admin(), private.assigned_candidates_access() to authenticated, service_role;
alter table public.assigned_candidates enable row level security;
alter table public.assigned_candidate_uploads enable row level security;
revoke all on public.assigned_candidates, public.assigned_candidate_uploads from anon, authenticated;
grant select on public.assigned_candidates to authenticated;
grant all on public.assigned_candidates, public.assigned_candidate_uploads to service_role;
create policy assigned_candidates_scoped_read on public.assigned_candidates for select to authenticated
  using ((select private.assigned_candidates_access()) and
    (assigned_consultant_id = (select auth.uid()) or (select private.assigned_candidates_admin())));
-- CV metadata and mutations are backend-only. Storage has no client policies.
insert into public.page_view_permissions(page_key, view_permission) values ('assigned_candidates','everyone') on conflict do nothing;

create or replace function public.assigned_candidates_timestamps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.assigned_consultant_id is distinct from old.assigned_consultant_id then
    perform 1 from public.employee_statuses where user_id=new.assigned_consultant_id::text and status='active' for share;
    if not found then raise exception 'Only Active employees can receive assignments'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.assigned_at := now(); new.created_at := now();
    new.contacted_at := case when new.status not in ('Not Contacted','Didn’t Pick Up') then now() else null end;
  else
    new.assigned_at := old.assigned_at; new.created_at := old.created_at;
    new.contacted_at := coalesce(old.contacted_at, case when new.status not in ('Not Contacted','Didn’t Pick Up') then now() end);
  end if;
  new.updated_at := now(); return new;
end;
$$;
revoke all on function public.assigned_candidates_timestamps() from public, anon, authenticated;
create trigger assigned_candidates_timestamps before insert or update on public.assigned_candidates
  for each row execute function public.assigned_candidates_timestamps();
create or replace function public.assigned_candidates_retire_cv() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.assigned_candidate_uploads set retired_at = now() where id = old.upload_id;
  return old;
end;
$$;
revoke all on function public.assigned_candidates_retire_cv() from public, anon, authenticated;
create trigger assigned_candidates_retire_cv after delete on public.assigned_candidates
  for each row execute function public.assigned_candidates_retire_cv();

-- Match the existing admin_users user-ID/email convention without granting
-- service_role broad access to auth.users. This helper is private and service-only.
create or replace function private.assigned_candidates_actor_admin(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() <> p_actor then return false; end if;
  return exists (select 1 from public.admin_users a join auth.users au on au.id=p_actor
    where a.user_id=p_actor or lower(a.email)=lower(au.email));
end;
$$;
revoke all on function private.assigned_candidates_actor_admin(uuid) from public, anon, authenticated;
grant execute on function private.assigned_candidates_actor_admin(uuid) to service_role;

-- Idempotency is the unique upload ID. Entire batch commits or rolls back.
create or replace function public.create_assigned_candidates(p_actor uuid, p_rows jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; u public.assigned_candidate_uploads; saved public.assigned_candidates; n integer := 0;
begin
  if not exists (select 1 from public.employee_statuses where user_id = p_actor::text and status <> 'inactive')
    or not private.assigned_candidates_actor_admin(p_actor) then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then raise exception 'Select at least one CV'; end if;
  for r in select value from jsonb_array_elements(p_rows) order by value->>'upload_id' loop
    select * into u from public.assigned_candidate_uploads where id=(r->>'upload_id')::uuid for update;
    if not found or not u.storage_ready or u.uploaded_by <> p_actor or u.retired_at is not null or u.cleanup_claimed_at is not null then
      raise exception 'CV is unavailable. Upload it again.';
    end if;
    select * into saved from public.assigned_candidates where upload_id=u.id;
    if found then
      if saved.full_name <> r->>'full_name' or saved.mobile_number <> r->>'mobile_number' or saved.client_id is distinct from (r->>'client_id')::uuid
        or saved.job_id is distinct from (r->>'job_id')::uuid or saved.assigned_consultant_id <> (r->>'assigned_consultant_id')::uuid then
        raise exception 'This CV was already assigned. Refresh the list.';
      end if;
      n := n+1; continue;
    end if;
    perform 1 from public.employee_statuses where user_id=r->>'assigned_consultant_id' and status='active' for share;
    if not found or not exists (select 1 from public.user_profiles where user_id=r->>'assigned_consultant_id') then raise exception 'Only Active employees can receive assignments'; end if;
    if not exists (select 1 from public.jobs where id=(r->>'job_id')::uuid and client_id=(r->>'client_id')::uuid) then raise exception 'Invalid client and mandate combination'; end if;
    insert into public.assigned_candidates(upload_id, full_name, mobile_number, client_id, job_id, assigned_consultant_id, assigned_by, status)
      values (u.id,r->>'full_name',r->>'mobile_number',(r->>'client_id')::uuid,(r->>'job_id')::uuid,(r->>'assigned_consultant_id')::uuid,p_actor,r->>'status');
    update public.assigned_candidate_uploads set expires_at='infinity' where id=u.id;
    n := n+1;
  end loop;
  return n;
end;
$$;

create or replace function public.assigned_candidates_stats(p_scope uuid default null, p_active_only boolean default false) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('assigned', count(*), 'added', count(*) filter(where a.added_at is not null),
    'did_not_pick_up',count(*) filter(where a.status='Didn’t Pick Up'), 'not_contacted',count(*) filter(where a.status='Not Contacted'))
  from public.assigned_candidates a where (p_scope is null or a.assigned_consultant_id=p_scope)
    and (not p_active_only or exists (select 1 from public.employee_statuses e where e.user_id=a.assigned_consultant_id::text and e.status='active'));
$$;
create or replace function public.assigned_candidates_consultant_counts() returns table(user_id uuid, not_contacted bigint)
language sql stable security invoker set search_path = '' as $$
  select a.assigned_consultant_id, count(*) from public.assigned_candidates a
  join public.employee_statuses e on e.user_id=a.assigned_consultant_id::text and e.status='active'
  where a.status='Not Contacted' group by a.assigned_consultant_id;
$$;

-- Existing JS validation and duplicate workflow run before this transaction.
-- This lock makes retries and simultaneous transfers safe, including a lost response.
create or replace function public.transfer_assigned_candidate(p_id uuid, p_actor uuid, p_candidate jsonb, p_association jsonb, p_existing uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.assigned_candidates; u public.assigned_candidate_uploads; c public.candidates;
  ca public.candidate_associations; cp public.candidates; ap public.candidate_associations;
begin
  select * into a from public.assigned_candidates where id=p_id for update;
  if not found then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if not exists (select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') or
    (a.assigned_consultant_id<>p_actor and not private.assigned_candidates_actor_admin(p_actor)) then
    raise exception 'Assignment access denied' using errcode='42501';
  end if;
  if a.added_at is not null then
    select * into ca from public.candidate_associations where id=a.association_id;
    select * into c from public.candidates where id=a.candidate_id;
    return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)), 'idempotent',true);
  end if;
  if a.status in ('Not Contacted','Didn’t Pick Up') then raise exception 'Contact the candidate and update the assignment status before adding to Candidates' using errcode='22023'; end if;
  if p_association->>'status' not in ('Interested','In Discussion','Not Interested','Interview','Client Submission','Offered','Hired','Offer Declined','Dropout','Rejected by Recruiter','Rejected by Client') then raise exception 'Select a valid Candidates status'; end if;
  if not exists(select 1 from public.jobs where id=(p_association->>'job_id')::uuid and client_id=(p_association->>'client_id')::uuid) then raise exception 'Invalid client and mandate combination'; end if;
  select * into u from public.assigned_candidate_uploads where id=a.upload_id for update;
  if u.cleanup_claimed_at is not null then raise exception 'CV is unavailable'; end if;
  -- Use the same identity convention as candidateCreation.findCandidateRowsByIdentity.
  perform pg_advisory_xact_lock(hashtext('assigned-candidate-transfer'),hashtext(lower(coalesce(p_candidate->>'email',''))));
  perform pg_advisory_xact_lock(hashtext('assigned-candidate-transfer-mobile'),hashtext(regexp_replace(coalesce(p_candidate->>'mobile_number',''),'\D','','g')));
  if exists(select 1 from public.candidates x where x.id is distinct from p_existing and
    ((nullif(p_candidate->>'email','') is not null and lower(x.email)=lower(p_candidate->>'email')) or
     (regexp_replace(coalesce(p_candidate->>'mobile_number',''),'\D','','g')<>'' and regexp_replace(coalesce(x.mobile_number,''),'\D','','g')=regexp_replace(p_candidate->>'mobile_number','\D','','g')))) then
    raise exception 'Candidate identity changed during save. Retry to review duplicates.' using errcode='23505';
  end if;
  if p_existing is not null then
    select * into c from public.candidates where id=p_existing for update;
    if not found then raise exception 'Existing candidate no longer exists'; end if;
    cp := jsonb_populate_record(c,p_candidate);
    update public.candidates set full_name=cp.full_name,email=cp.email,mobile_number=cp.mobile_number,city=cp.city,state=cp.state,location=cp.location,current_designation=cp.current_designation,current_company=cp.current_company,current_organisation=cp.current_organisation,experience_years=cp.experience_years,notice_period=cp.notice_period,open_to_relocate=cp.open_to_relocate,skills=cp.skills,education=cp.education,linkedin_url=cp.linkedin_url where id=p_existing;
    -- Preserve the existing CV and append the assigned document once.
    update public.candidates set cv_attachments=coalesce(cv_attachments,'[]'::jsonb)||case when coalesce(cv_attachments,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path',u.cv_storage_path)) then '[]'::jsonb else jsonb_build_array(jsonb_build_object('path',u.cv_storage_path,'name',u.cv_original_name,'mime_type',u.cv_mimetype,'file_hash',u.cv_file_hash)) end,
      updated_at=now(),updated_by=p_actor where id=p_existing returning * into c;
    select * into ca from public.candidate_associations where candidate_id=p_existing
      and client_id=(p_association->>'client_id')::uuid and job_id=(p_association->>'job_id')::uuid
      order by created_at,id limit 1 for update;
    if found then
      ap := jsonb_populate_record(ca,p_association);
      update public.candidate_associations set status=ap.status,consultant_name=ap.consultant_name,
        consultant_user_id=ap.consultant_user_id,current_salary=ap.current_salary,expected_salary=ap.expected_salary,
        offered_ctc=ap.offered_ctc,date_of_joining=ap.date_of_joining,notes=ap.notes,updated_by=p_actor,updated_at=now()
        where id=ca.id returning * into ca;
      update public.assigned_candidates set candidate_id=c.id,association_id=ca.id,added_at=now() where id=a.id;
      if ca.status='Hired' then update public.jobs set mandate_status='Completed',status='Completed' where id=ca.job_id and mandate_status<>'Scrapped'; end if;
      return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)),'idempotent',false);
    end if;
  else
    cp := jsonb_populate_record(null::public.candidates,p_candidate);
    insert into public.candidates(full_name,email,mobile_number,city,state,location,current_designation,current_company,current_organisation,experience_years,notice_period,open_to_relocate,skills,education,linkedin_url,source,client_id,cv_storage_path,cv_link,resume_url,cv_original_name,cv_mimetype,cv_file_hash,cv_attachments,created_by)
      values(cp.full_name,cp.email,cp.mobile_number,cp.city,cp.state,cp.location,cp.current_designation,cp.current_company,cp.current_organisation,cp.experience_years,cp.notice_period,cp.open_to_relocate,coalesce(cp.skills,'{}'),cp.education,cp.linkedin_url,'manual',cp.client_id,u.cv_storage_path,u.cv_storage_path,u.cv_storage_path,u.cv_original_name,u.cv_mimetype,u.cv_file_hash,jsonb_build_array(jsonb_build_object('path',u.cv_storage_path,'name',u.cv_original_name,'mime_type',u.cv_mimetype,'file_hash',u.cv_file_hash,'size',u.file_size)),p_actor) returning * into c;
  end if;
  ap := jsonb_populate_record(null::public.candidate_associations,p_association);
  insert into public.candidate_associations(candidate_id,client_id,job_id,client_name,job_title,consultant_name,consultant_user_id,status,current_salary,expected_salary,offered_ctc,date_of_joining,notes,created_by,assigned_candidate_id)
    values(c.id,ap.client_id,ap.job_id,ap.client_name,ap.job_title,ap.consultant_name,ap.consultant_user_id,ap.status,ap.current_salary,ap.expected_salary,ap.offered_ctc,ap.date_of_joining,ap.notes,p_actor,a.id) returning * into ca;
  update public.assigned_candidates set candidate_id=c.id,association_id=ca.id,added_at=now() where id=a.id;
  if ca.status='Hired' then update public.jobs set mandate_status='Completed', status='Completed' where id=ca.job_id and mandate_status<>'Scrapped'; end if;
  return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)), 'idempotent',false);
end;
$$;

-- Mutations and aggregates are service-only; controllers resolve the caller's scope.
revoke all on function public.create_assigned_candidates(uuid,jsonb), public.assigned_candidates_stats(uuid,boolean), public.assigned_candidates_consultant_counts(), public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.create_assigned_candidates(uuid,jsonb), public.assigned_candidates_stats(uuid,boolean), public.assigned_candidates_consultant_counts(), public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.assigned_candidates;
  end if;
end $$;

create or replace function public.delete_assigned_candidates(p_actor uuid, p_scope uuid default null, p_ids uuid[] default null, p_contacted_only boolean default false) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare n bigint;
begin
  if not exists(select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') or
    not private.assigned_candidates_actor_admin(p_actor) then
    raise exception 'Admin required' using errcode='42501'; end if;
  if not p_contacted_only and coalesce(cardinality(p_ids),0)=0 then raise exception 'Select assignments to delete'; end if;
  if p_ids is not null and (select count(*) from public.assigned_candidates where id=any(p_ids) and (p_scope is null or assigned_consultant_id=p_scope)) <> cardinality(p_ids) then
    -- Already deleted IDs are safe on retry; existing out-of-scope IDs are never deleted.
    if exists(select 1 from public.assigned_candidates where id=any(p_ids) and p_scope is not null and assigned_consultant_id<>p_scope) then
      raise exception 'Selection is outside the selected consultant scope' using errcode='42501'; end if;
  end if;
  delete from public.assigned_candidates where (p_scope is null or assigned_consultant_id=p_scope)
    and (p_ids is null or id=any(p_ids)) and (not p_contacted_only or status not in ('Not Contacted','Didn’t Pick Up'));
  get diagnostics n = row_count;
  return n;
end;
$$;
create or replace function public.claim_assigned_cv_cleanup(p_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare u public.assigned_candidate_uploads;
begin
  select * into u from public.assigned_candidate_uploads where id=p_id for update;
  if not found or (u.retired_at is null and u.expires_at>now())
    or (u.cleanup_claimed_at is not null and u.cleanup_claimed_at>now()-interval '10 minutes')
    or exists(select 1 from public.assigned_candidates where upload_id=p_id) then return false; end if;
  update public.assigned_candidate_uploads set cleanup_claimed_at=now() where id=p_id;
  return true;
end;
$$;
revoke all on function public.delete_assigned_candidates(uuid,uuid,uuid[],boolean), public.claim_assigned_cv_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.delete_assigned_candidates(uuid,uuid,uuid[],boolean), public.claim_assigned_cv_cleanup(uuid) to service_role;
