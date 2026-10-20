-- All row mutations use the same grant as New / Delete All and retain own-row scope.
alter table public.assigned_candidates add column version bigint not null default 1;
create function public.assigned_candidate_version() returns trigger
language plpgsql set search_path='' as $$ begin new.version:=old.version+1; return new; end; $$;
revoke all on function public.assigned_candidate_version() from public,anon,authenticated;
create trigger assigned_candidate_version before update on public.assigned_candidates
  for each row execute function public.assigned_candidate_version();
create function public.update_assigned_candidate(p_actor uuid,p_id uuid,p_data jsonb,p_expected_version bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old_row public.assigned_candidates; saved public.assigned_candidates; merged jsonb;
begin
  if not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_manage') then
    raise exception 'Assignment actions access required' using errcode='42501';
  end if;
  select * into old_row from public.assigned_candidates where id=p_id
    and (private.assigned_candidates_actor_admin(p_actor) or assigned_consultant_id=p_actor) for update;
  if not found then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if p_expected_version is null or old_row.version<>p_expected_version then
    raise exception 'This assignment changed. Reload it before saving.' using errcode='40001';
  end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k
    where k not in ('full_name','mobile_number','client_id','job_id','assigned_consultant_id','status')) then
    raise exception 'Invalid assignment fields';
  end if;
  merged:=to_jsonb(old_row)||p_data;
  if coalesce(length(btrim(merged->>'full_name')),0) not between 1 and 200
    or coalesce(merged->>'mobile_number','') !~ '^(-|[+]?[0-9]{7,15})$' then raise exception 'Invalid candidate name or mobile'; end if;
  if (merged->>'assigned_consultant_id')::uuid is distinct from old_row.assigned_consultant_id then
    perform 1 from public.employee_statuses where user_id=merged->>'assigned_consultant_id' and status='active' for share;
    if not found or not exists(select 1 from public.user_profiles where user_id=merged->>'assigned_consultant_id') then
      raise exception 'Select an active consultant';
    end if;
  end if;
  if not exists(select 1 from public.jobs where id=(merged->>'job_id')::uuid and client_id=(merged->>'client_id')::uuid) then
    raise exception 'Selected mandate does not belong to the selected client';
  end if;
  update public.assigned_candidates set full_name=btrim(merged->>'full_name'),mobile_number=merged->>'mobile_number',
    client_id=(merged->>'client_id')::uuid,job_id=(merged->>'job_id')::uuid,
    assigned_consultant_id=(merged->>'assigned_consultant_id')::uuid,status=merged->>'status'
    where id=p_id returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.update_assigned_candidate(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.update_assigned_candidate(uuid,uuid,jsonb,bigint) to service_role;

create or replace function public.delete_assigned_candidates(p_actor uuid, p_scope uuid default null, p_ids uuid[] default null, p_contacted_only boolean default false) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare n bigint;
begin
  p_contacted_only:=coalesce(p_contacted_only,false);
  if not exists(select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') then
    raise exception 'Active employee required' using errcode='42501'; end if;
  if p_contacted_only then
    if not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_manage') or p_ids is not null then
      raise exception 'Delete All access required' using errcode='42501'; end if;
    if not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_overall') then
      if p_scope is not null and p_scope<>p_actor then raise exception 'Own consultant scope required' using errcode='42501'; end if;
      p_scope:=p_actor;
    end if;
  elsif not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_manage') then
    raise exception 'Assignment actions access required' using errcode='42501';
  end if;
  if not private.assigned_candidates_actor_admin(p_actor) and not p_contacted_only then
    if p_scope is not null and p_scope<>p_actor then raise exception 'Own consultant scope required' using errcode='42501'; end if;
    p_scope:=p_actor;
  end if;
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
