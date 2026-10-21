-- Status-only workflow is available to active assignees without New/Delete.
-- Full edits/reassignment keep using the unchanged, manage-gated RPC.
create function public.set_assigned_candidate_status(
  p_actor uuid, p_id uuid, p_status text, p_expected_version bigint
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare current_row public.assigned_candidates; saved public.assigned_candidates;
begin
  if p_actor is null or (auth.uid() is not null and auth.uid() <> p_actor)
    or not exists(select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') then
    raise exception 'Assignment access denied' using errcode='42501';
  end if;
  select * into current_row from public.assigned_candidates where id=p_id
    and (assigned_consultant_id=p_actor or private.assigned_candidates_actor_admin(p_actor)) for update;
  if not found then raise exception 'Assignment not found' using errcode='P0002'; end if;
  if p_expected_version is null or current_row.version<>p_expected_version then
    raise exception 'This assignment changed. Reload it before saving.' using errcode='40001';
  end if;
  if p_status is null or p_status not in ('Not Contacted','Didn’t Pick Up','Interested','Not Interested','In Discussion','Rejected by Recruiter','Not Relevant') then
    raise exception 'Select a valid status' using errcode='22023';
  end if;
  update public.assigned_candidates set status=p_status where id=current_row.id returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.set_assigned_candidate_status(uuid,uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.set_assigned_candidate_status(uuid,uuid,text,bigint) to service_role;
