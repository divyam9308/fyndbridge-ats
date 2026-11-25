-- Forward-only: no historical CV hashing, branding, reference cleanup, or data rewrite.
alter table public.cv_branding_jobs add column input_sha256 text;
create index cv_branding_jobs_source_identity on public.cv_branding_jobs(source_sha256) where status='ready';
create index cv_branding_jobs_result_identity on public.cv_branding_jobs(result_sha256) where status='ready';

-- A terminated worker must not leave its third claim stuck in processing.
-- Exhausted leases become visible failures; retry remains an explicit action.
create or replace function public.claim_cv_branding_jobs(p_paths text[] default null,p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare claimed_jobs jsonb;
begin
  with exhausted as (
    select id from public.cv_branding_jobs where status='processing' and attempts>=3
      and lease_until<now() and (p_paths is null or target_path=any(p_paths))
      for update skip locked limit 20
  ) update public.cv_branding_jobs j set status='failed',lease_token=null,lease_until=null,
      last_error='CV processing was interrupted. Please retry.',updated_at=now()
    from exhausted where j.id=exhausted.id;
  with pending as (
    select id from public.cv_branding_jobs
    where (p_paths is null or target_path=any(p_paths)) and (lease_until is null or lease_until<now())
      and next_attempt_at<=now()
      and ((status in ('queued','processing','failed') and attempts<3)
        or status='finalizing' or (status='cancelled' and source_path is not null))
    order by created_at for update skip locked limit greatest(1,least(p_limit,5))
  ), claimed as (
    update public.cv_branding_jobs j set status=case when j.status in ('finalizing','cancelled') then j.status else 'processing' end,
      attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
    from pending where j.id=pending.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into claimed_jobs from claimed;
  return claimed_jobs;
end $$;
revoke all on function public.claim_cv_branding_jobs(text[],integer) from public,anon,authenticated;
grant execute on function public.claim_cv_branding_jobs(text[],integer) to service_role;

create table public.assigned_cv_transfer_requests (
  assignment_id uuid primary key references public.assigned_candidates(id) on delete cascade,
  actor_id uuid not null,
  candidate_payload jsonb not null,
  association_payload jsonb not null,
  existing_candidate_id uuid,
  source_path text,
  target_path text,
  source_sha256 text,
  status text not null default 'pending' check(status in ('pending','failed','complete')),
  last_error text,
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.assigned_cv_transfer_requests enable row level security;
revoke all on public.assigned_cv_transfer_requests from public,anon,authenticated;
grant all on public.assigned_cv_transfer_requests to service_role;
create index assigned_cv_transfer_requests_pending on public.assigned_cv_transfer_requests(next_attempt_at,created_at) where status='pending';

-- Permanent tombstones make the nontransactional Storage deletion recoverable.
-- No writer can create a new reference after deletion has been claimed.
create table public.cv_storage_deletion_claims (
  path text primary key,
  claimed_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table public.cv_storage_deletion_claims enable row level security;
revoke all on public.cv_storage_deletion_claims from public,anon,authenticated;
grant all on public.cv_storage_deletion_claims to service_role;

create function private.cv_decode_url_component(p_value text) returns text
language plpgsql immutable strict set search_path='' as $$
declare remaining text:=p_value; result bytea:=''; ch text;
begin
  while length(remaining)>0 loop
    if remaining ~ '^%[0-9a-fA-F]{2}' then
      result:=result||decode(substr(remaining,2,2),'hex'); remaining:=substr(remaining,4);
    else
      ch:=left(remaining,1); result:=result||convert_to(ch,'UTF8'); remaining:=substr(remaining,2);
    end if;
  end loop;
  return convert_from(result,'UTF8');
exception when others then return p_value;
end $$;

create function public.normalize_cv_storage_path(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare value text:=btrim(coalesce(p_value,'')); marker integer; previous text;
begin
  if value='' or value='-' or value like '/tmp/%' then return ''; end if;
  if value ~ '^https?://' then
    marker:=strpos(value,'/storage/v1/object/');
    if marker>0 then value:=split_part(substr(value,marker+19),'?',1);
    elsif value ~ '^https?://[^/]+/api/documents/open' then value:=coalesce(substring(value from '[?&]path=([^&]+)'), '');
    else return value; end if;
  elsif value like '/api/documents/open%' then value:=coalesce(substring(value from '[?&]path=([^&]+)'), '');
  end if;
  value:=private.cv_decode_url_component(value);
  loop
    previous:=value;
    value:=regexp_replace(value,'^(public|sign|authenticated|resumes|resume|cvs|cv|candidate-cvs|candidate_cvs)/','');
    exit when previous=value;
  end loop;
  return value;
end $$;

create function private.cv_record_paths(p_record jsonb) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(distinct p) filter(where p<>''),'{}'::text[])
  from (
    select public.normalize_cv_storage_path(p_record->>f) as p
    from unnest(array['cv_storage_path','cv_link','resume_url']) f
    union all
    select public.normalize_cv_storage_path(coalesce(a->>'path',a->>'storage_path',a->>'storagePath',a->>'url'))
    from jsonb_array_elements(case when jsonb_typeof(p_record->'cv_attachments')='array' then p_record->'cv_attachments' else '[]'::jsonb end) a
  ) refs
$$;

create function public.cv_storage_reference_counts(p_paths text[]) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('path',p,'candidates',c,'uploads',u,'transfers',t)),'[]'::jsonb)
  from (
    select p,
      (select count(*) from public.candidates x where p=any(private.cv_record_paths(to_jsonb(x)))) c,
      (select count(*) from public.assigned_candidate_uploads x where public.normalize_cv_storage_path(x.cv_storage_path)=p) u,
      (select count(*) from public.assigned_cv_transfer_requests x where x.status in ('pending','failed') and p in (public.normalize_cv_storage_path(x.source_path),public.normalize_cv_storage_path(x.target_path))) t
    from (select distinct public.normalize_cv_storage_path(v) p from unnest(p_paths) v) wanted where p<>''
  ) counts
$$;

create function private.guard_cv_storage_references() returns trigger
language plpgsql security definer set search_path='' as $$
declare paths text[]; old_paths text[]:='{}'; p text;
begin
  if tg_table_name='assigned_cv_transfer_requests' then
    paths:=array[public.normalize_cv_storage_path(new.source_path),public.normalize_cv_storage_path(new.target_path)];
    if new.status='complete' then return new; end if;
    if tg_op='UPDATE' and old.status in ('pending','failed') then old_paths:=array[public.normalize_cv_storage_path(old.source_path),public.normalize_cv_storage_path(old.target_path)]; end if;
  elsif tg_table_name='assigned_candidate_uploads' then
    paths:=array[public.normalize_cv_storage_path(new.cv_storage_path)];
    if tg_op='UPDATE' then old_paths:=array[public.normalize_cv_storage_path(old.cv_storage_path)]; end if;
  else
    paths:=private.cv_record_paths(to_jsonb(new));
    if tg_op='UPDATE' then old_paths:=private.cv_record_paths(to_jsonb(old)); end if;
  end if;
  for p in select distinct v from unnest(paths) v where v<>'' and not(v=any(old_paths)) order by v loop
    perform pg_advisory_xact_lock(hashtext('cv-storage-reference'),hashtext(p));
    if exists(select 1 from public.cv_storage_deletion_claims d where d.path=p) then
      raise exception 'This CV is unavailable. Upload it again.' using errcode='55000';
    end if;
  end loop;
  return new;
end $$;
create trigger candidates_cv_storage_guard before insert or update of cv_storage_path,cv_link,resume_url,cv_attachments on public.candidates for each row execute function private.guard_cv_storage_references();
create trigger assigned_uploads_cv_storage_guard before insert or update of cv_storage_path on public.assigned_candidate_uploads for each row execute function private.guard_cv_storage_references();
create trigger assigned_transfer_cv_storage_guard before insert or update of source_path,target_path,status on public.assigned_cv_transfer_requests for each row execute function private.guard_cv_storage_references();

create function public.claim_cv_storage_deletion(p_path text,p_ignore_upload uuid default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_path text:=public.normalize_cv_storage_path(p_path);
begin
  if v_path='' or v_path ~ '^https?://' then return false; end if;
  perform pg_advisory_xact_lock(hashtext('cv-storage-reference'),hashtext(v_path));
  if exists(select 1 from public.candidates x where v_path=any(private.cv_record_paths(to_jsonb(x))))
    or exists(select 1 from public.assigned_candidate_uploads x where public.normalize_cv_storage_path(x.cv_storage_path)=v_path
      and not(x.id is not distinct from p_ignore_upload and x.cleanup_claimed_at is not null and not exists(select 1 from public.assigned_candidates a where a.upload_id=x.id)))
    or exists(select 1 from public.assigned_cv_transfer_requests x where x.status in ('pending','failed') and v_path in (public.normalize_cv_storage_path(x.source_path),public.normalize_cv_storage_path(x.target_path))) then return false; end if;
  insert into public.cv_storage_deletion_claims(path) values(v_path) on conflict do nothing;
  update public.cv_branding_jobs set status='cancelled',updated_at=now() where public.normalize_cv_storage_path(target_path)=v_path and status<>'cancelled';
  return true;
end $$;

-- Canonical identity never depends on a name or a branded-looking path.
create function private.cv_source_identity(p_path text,p_hash text,p_evidence jsonb default '{}'::jsonb) returns text
language plpgsql stable set search_path='' as $$
declare normalized text:=public.normalize_cv_storage_path(p_path); identity text; declared text:=lower(btrim(coalesce(p_hash,'')));
begin
  if p_evidence ? normalized then
    identity:=lower(coalesce(p_evidence->>normalized,''));
    return case when identity ~ '^[0-9a-f]{64}$' then identity else '' end;
  end if;
  select source_sha256 into identity from public.cv_branding_jobs
    where status='ready' and result_sha256 ~ '^[0-9a-f]{64}$' and source_sha256 ~ '^[0-9a-f]{64}$'
      and (p_evidence->'__verified_paths'->>normalized)='true'
      and (public.normalize_cv_storage_path(target_path)=normalized or result_sha256=declared)
    order by (public.normalize_cv_storage_path(target_path)=normalized) desc,completed_at,id limit 1;
  if identity is not null then return identity; end if;
  identity:=lower(coalesce(p_evidence->>normalized,''));
  if identity ~ '^[0-9a-f]{64}$' then return identity; end if;
  if declared ~ '^[0-9a-f]{64}$' then return declared; end if;
  return '';
end $$;

create function private.merge_candidate_cv_documents(p_candidate jsonb,p_incoming jsonb,p_evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare docs jsonb:='[]'; result jsonb:='[]'; item jsonb; existing jsonb; legacy jsonb; p text; identity text; existing_identity text; idx integer; matched integer; incoming_verified boolean; existing_verified boolean;
begin
  -- Retain all primary aliases even when a secondary attachment list exists.
  for p in select public.normalize_cv_storage_path(p_candidate->>f) from unnest(array['cv_storage_path','cv_link','resume_url']) f loop
    if p<>'' then
      legacy:=jsonb_build_object('path',p,'name',coalesce(p_candidate->>'cv_original_name',''),'mime_type',coalesce(p_candidate->>'cv_mimetype',''),'file_hash',coalesce(p_candidate->>'cv_file_hash',''));
      docs:=docs||jsonb_build_array(legacy);
    end if;
  end loop;
  docs:=docs||case when jsonb_typeof(p_candidate->'cv_attachments')='array' then p_candidate->'cv_attachments' else '[]'::jsonb end;
  if p_incoming is not null and coalesce(p_incoming->>'path','')<>'' then docs:=docs||jsonb_build_array(p_incoming); end if;
  for item in select value from jsonb_array_elements(docs) loop
    p:=public.normalize_cv_storage_path(coalesce(item->>'path',item->>'storage_path',item->>'storagePath',item->>'url'));
    if p='' then continue; end if;
    identity:=private.cv_source_identity(p,coalesce(item->>'source_sha256',item->>'file_hash'),p_evidence);
    item:=item||jsonb_build_object('path',p);
    if identity<>'' then item:=item||jsonb_build_object('file_hash',identity,'source_sha256',identity); end if;
    matched:=-1; idx:=0;
    for existing in select value from jsonb_array_elements(result) loop
      existing_identity:=private.cv_source_identity(existing->>'path',coalesce(existing->>'source_sha256',existing->>'file_hash'),p_evidence);
      if existing->>'path'=p or (identity<>'' and identity=existing_identity) then matched:=idx; exit; end if;
      idx:=idx+1;
    end loop;
    if matched<0 then result:=result||jsonb_build_array(item);
    else
      incoming_verified:=coalesce((p_evidence->'__verified_paths'->>p)='true',false) and exists(select 1 from public.cv_branding_jobs where status='ready' and target_path=p and result_sha256 ~ '^[0-9a-f]{64}$');
      existing_verified:=coalesce((p_evidence->'__verified_paths'->>(existing->>'path'))='true',false) and exists(select 1 from public.cv_branding_jobs where status='ready' and target_path=existing->>'path' and result_sha256 ~ '^[0-9a-f]{64}$');
      if incoming_verified and not existing_verified then result:=jsonb_set(result,array[matched::text],item);
      elsif existing->>'path'=p then result:=jsonb_set(result,array[matched::text],existing||jsonb_strip_nulls(item)); end if;
    end if;
  end loop;
  return result;
end $$;

create or replace function public.transfer_assigned_candidate(p_id uuid, p_actor uuid, p_candidate jsonb, p_association jsonb, p_existing uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare a public.assigned_candidates; u public.assigned_candidate_uploads; c public.candidates;
  ca public.candidate_associations; cp public.candidates; ap public.candidate_associations;
  request public.assigned_cv_transfer_requests; branding public.cv_branding_jobs; snapshot_field text; incoming jsonb; documents jsonb; primary_cv jsonb;
begin
  select * into a from public.assigned_candidates where id=p_id for update;
  if not found then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if not exists (select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') or
    (a.assigned_consultant_id<>p_actor and not private.assigned_candidates_actor_admin(p_actor) and not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_overall')) then
    raise exception 'Assignment access denied' using errcode='42501';
  end if;
  if a.added_at is not null then
    select * into ca from public.candidate_associations where id=a.association_id;
    select * into c from public.candidates where id=a.candidate_id;
    update public.assigned_cv_transfer_requests set status='complete',last_error=null,updated_at=now() where assignment_id=a.id;
    return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)), 'idempotent',true);
  end if;
  if a.status = 'Not Relevant' then raise exception 'Not Relevant assignments cannot be added to Candidates' using errcode='22023'; end if;
  if a.status in ('Not Contacted','Didn’t Pick Up') then raise exception 'Contact the candidate and update the assignment status before adding to Candidates' using errcode='22023'; end if;
  if p_association->>'status' not in ('Interested','In Discussion','Not Interested','Interview','Client Submission','Offered','Hired','Offer Declined','Dropout','Rejected by Recruiter','Rejected by Client') then raise exception 'Select a valid Candidates status'; end if;
  if not exists(select 1 from public.jobs where id=(p_association->>'job_id')::uuid and client_id=(p_association->>'client_id')::uuid) then raise exception 'Invalid client and mandate combination'; end if;
  select * into u from public.assigned_candidate_uploads where id=a.upload_id for update;
  if u.cleanup_claimed_at is not null then raise exception 'CV is unavailable'; end if;
  select * into request from public.assigned_cv_transfer_requests where assignment_id=a.id for update;
  if public.normalize_cv_storage_path(u.cv_storage_path)<>'' then
    if request.assignment_id is null or request.actor_id<>p_actor or request.status='complete' or request.target_path is null then
      raise exception 'CV branding is required before transfer' using errcode='55000';
    end if;
    select * into branding from public.cv_branding_jobs where target_path=request.target_path and status='ready'
      and result_sha256 ~ '^[0-9a-f]{64}$' and source_sha256 ~ '^[0-9a-f]{64}$' and page_count>0;
    if not found or branding.source_sha256 is distinct from request.source_sha256 then
      raise exception 'The CV is being branded. Retry after processing completes.' using errcode='55000';
    end if;
    incoming:=jsonb_build_object('path',branding.target_path,'name',regexp_replace(u.cv_original_name,'\.(pdf|docx?)$','','i')||'.pdf',
      'mime_type','application/pdf','file_hash',branding.source_sha256,'source_sha256',branding.source_sha256,'size',branding.file_size);
  end if;
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
    if p_candidate ? '_cv_identity_snapshot' then
      foreach snapshot_field in array array['cv_attachments','cv_storage_path','cv_link','resume_url','cv_file_hash','cv_original_name','cv_mimetype'] loop
        if (to_jsonb(c)->snapshot_field) is distinct from (p_candidate->'_cv_identity_snapshot'->snapshot_field) then
          raise exception 'Candidate CVs changed during verification. Retry.' using errcode='40001';
        end if;
      end loop;
    end if;
    cp := jsonb_populate_record(c,p_candidate);
    update public.candidates set full_name=cp.full_name,email=cp.email,mobile_number=cp.mobile_number,city=cp.city,state=cp.state,location=cp.location,current_designation=cp.current_designation,current_company=cp.current_company,current_organisation=cp.current_organisation,experience_years=cp.experience_years,notice_period=cp.notice_period,open_to_relocate=cp.open_to_relocate,skills=cp.skills,education=cp.education,linkedin_url=cp.linkedin_url where id=p_existing;
    -- This destination row is locked: simultaneous assignments cannot append
    -- the same source twice. Evidence was calculated only for this candidate.
    documents:=private.merge_candidate_cv_documents(to_jsonb(c),incoming,coalesce(p_candidate->'_cv_identity_evidence','{}'::jsonb));
    primary_cv:=documents->0;
    update public.candidates set cv_attachments=documents,
      cv_storage_path=primary_cv->>'path',cv_link=primary_cv->>'path',resume_url=primary_cv->>'path',
      cv_original_name=primary_cv->>'name',cv_mimetype=primary_cv->>'mime_type',cv_file_hash=primary_cv->>'file_hash',
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
      update public.assigned_cv_transfer_requests set status='complete',last_error=null,updated_at=now() where assignment_id=a.id;
      return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)),'idempotent',false);
    end if;
  else
    cp := jsonb_populate_record(null::public.candidates,p_candidate);
    documents:=private.merge_candidate_cv_documents('{}'::jsonb,incoming,coalesce(p_candidate->'_cv_identity_evidence','{}'::jsonb));
    primary_cv:=documents->0;
    insert into public.candidates(full_name,email,mobile_number,city,state,location,current_designation,current_company,current_organisation,experience_years,notice_period,open_to_relocate,skills,education,linkedin_url,source,client_id,cv_storage_path,cv_link,resume_url,cv_original_name,cv_mimetype,cv_file_hash,cv_attachments,created_by)
      values(cp.full_name,cp.email,cp.mobile_number,cp.city,cp.state,cp.location,cp.current_designation,cp.current_company,cp.current_organisation,cp.experience_years,cp.notice_period,cp.open_to_relocate,coalesce(cp.skills,'{}'),cp.education,cp.linkedin_url,'manual',cp.client_id,primary_cv->>'path',primary_cv->>'path',primary_cv->>'path',primary_cv->>'name',primary_cv->>'mime_type',primary_cv->>'file_hash',documents,p_actor) returning * into c;
  end if;
  ap := jsonb_populate_record(null::public.candidate_associations,p_association);
  insert into public.candidate_associations(candidate_id,client_id,job_id,client_name,job_title,consultant_name,consultant_user_id,status,current_salary,expected_salary,offered_ctc,date_of_joining,notes,created_by,assigned_candidate_id)
    values(c.id,ap.client_id,ap.job_id,ap.client_name,ap.job_title,ap.consultant_name,ap.consultant_user_id,ap.status,ap.current_salary,ap.expected_salary,ap.offered_ctc,ap.date_of_joining,ap.notes,p_actor,a.id) returning * into ca;
  update public.assigned_candidates set candidate_id=c.id,association_id=ca.id,added_at=now() where id=a.id;
  if ca.status='Hired' then update public.jobs set mandate_status='Completed', status='Completed' where id=ca.job_id and mandate_status<>'Scrapped'; end if;
  update public.assigned_cv_transfer_requests set status='complete',last_error=null,updated_at=now() where assignment_id=a.id;
  return jsonb_build_object('association',to_jsonb(ca)||jsonb_build_object('candidates',to_jsonb(c)), 'idempotent',false);
end;
$$;
revoke all on function public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) to service_role;

revoke all on function public.normalize_cv_storage_path(text),public.cv_storage_reference_counts(text[]),public.claim_cv_storage_deletion(text,uuid) from public,anon,authenticated;
grant execute on function public.normalize_cv_storage_path(text),public.cv_storage_reference_counts(text[]),public.claim_cv_storage_deletion(text,uuid) to service_role;
revoke all on function private.cv_decode_url_component(text),private.cv_record_paths(jsonb),private.guard_cv_storage_references(),private.cv_source_identity(text,text,jsonb),private.merge_candidate_cv_documents(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.cv_decode_url_component(text),private.cv_record_paths(jsonb),private.cv_source_identity(text,text,jsonb),private.merge_candidate_cv_documents(jsonb,jsonb,jsonb) to service_role;

-- Bounded cleanup uses an explicit reviewed snapshot and changes references only.
create function public.consolidate_candidate_cv_duplicates(p_id uuid,p_expected jsonb,p_attachments jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.candidates; f text; primary_document jsonb; document jsonb;
begin
  select * into candidate from public.candidates where id=p_id for update;
  if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
  foreach f in array array['cv_attachments','cv_storage_path','cv_link','resume_url','cv_file_hash','cv_original_name','cv_mimetype'] loop
    if not(p_expected ? f) or (to_jsonb(candidate)->f) is distinct from (p_expected->f) then
      raise exception 'Candidate CVs changed after review. Run the dry-run again.' using errcode='PT409';
    end if;
  end loop;
  if jsonb_typeof(p_attachments) is distinct from 'array' then raise exception 'Expected retained CV attachments' using errcode='22023'; end if;
  for document in select value from jsonb_array_elements(p_attachments) loop
    if not(public.normalize_cv_storage_path(document->>'path')=any(private.cv_record_paths(to_jsonb(candidate)))) then
      raise exception 'Retained CV does not belong to this candidate' using errcode='22023';
    end if;
  end loop;
  primary_document:=p_attachments->0;
  update public.candidates set cv_attachments=p_attachments,cv_storage_path=primary_document->>'path',
    cv_link=primary_document->>'path',resume_url=primary_document->>'path',cv_file_hash=primary_document->>'file_hash',
    cv_original_name=primary_document->>'name',cv_mimetype=primary_document->>'mime_type',updated_at=now()
    where id=p_id returning * into candidate;
  return to_jsonb(candidate);
end $$;
revoke all on function public.consolidate_candidate_cv_duplicates(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.consolidate_candidate_cv_duplicates(uuid,jsonb,jsonb) to service_role;
