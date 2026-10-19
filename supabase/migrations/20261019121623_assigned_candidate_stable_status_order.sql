-- Keep ordinary unadded statuses in the original assignment order. Only the
-- explicit non-transferable groups and successfully added records move groups.
alter table public.assigned_candidates alter column sort_group set expression as (
  case when added_at is not null then 4
       when status = 'Didn’t Pick Up' then 1
       when status = 'Not Relevant' then 2
       else 0 end
);

-- Recheck the authoritative assignment status under the transfer row lock, so a
-- stale single/bulk form cannot add a record that became Not Relevant.
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
  if a.status = 'Not Relevant' then raise exception 'Not Relevant assignments cannot be added to Candidates' using errcode='22023'; end if;
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
revoke all on function public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid) to service_role;
