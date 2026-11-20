-- Overall access permits editing and transferring the assignments it exposes.
-- Keep New/Delete All, direct-table writes and browser RPC execution unchanged.
-- Change only authorization guards in the installed functions, preserving row
-- locks, PT409 version checks, validation, transfer logic and existing grants.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('public.update_assigned_candidate(uuid,uuid,jsonb,bigint)',
      'if not private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_manage'') then',
      'if not (private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_manage'') or private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_overall'')) then'),
    ('public.update_assigned_candidate(uuid,uuid,jsonb,bigint)',
      '(private.assigned_candidates_actor_admin(p_actor) or assigned_consultant_id=p_actor)',
      '(private.assigned_candidates_actor_admin(p_actor) or private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_overall'') or assigned_consultant_id=p_actor)'),
    ('public.set_assigned_candidate_status(uuid,uuid,text,bigint)',
      '(assigned_consultant_id=p_actor or private.assigned_candidates_actor_admin(p_actor))',
      '(assigned_consultant_id=p_actor or private.assigned_candidates_actor_admin(p_actor) or private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_overall''))'),
    ('public.transfer_assigned_candidate(uuid,uuid,jsonb,jsonb,uuid)',
      '(a.assigned_consultant_id<>p_actor and not private.assigned_candidates_actor_admin(p_actor))',
      '(a.assigned_consultant_id<>p_actor and not private.assigned_candidates_actor_admin(p_actor) and not private.consultant_resource_actor_allowed(p_actor,''assigned_candidates_overall''))')
  ) as guards(signature, old_guard, new_guard) loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if position(change.old_guard in definition) > 0 then
      execute replace(definition, change.old_guard, change.new_guard);
    elsif position(change.new_guard in definition) = 0 then
      raise exception 'Expected assignment access guard missing from %', change.signature;
    end if;
  end loop;
end;
$migration$;
