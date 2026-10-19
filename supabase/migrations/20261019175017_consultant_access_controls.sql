-- Add selected-consultant access to CRM and two Assigned Candidates controls.
-- Existing role values and unrelated page permissions remain intact.
alter table public.page_view_permissions add column allowed_user_ids uuid[] not null default '{}';
alter table public.page_view_permissions add constraint page_view_consultant_access_size check(cardinality(allowed_user_ids)<=200 and array_position(allowed_user_ids,null) is null);
insert into public.page_view_permissions(page_key,view_permission) values
  ('assigned_candidates_manage','admin_only'),('assigned_candidates_overall','admin_only') on conflict do nothing;

-- Private actor lookup: service RPCs pass only req.user.id. A browser JWT cannot
-- substitute another actor; neither browser role can execute this helper directly.
create function private.consultant_resource_actor_allowed(p_actor uuid,p_key text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare rule public.page_view_permissions; admin_allowed boolean; super_allowed boolean;
begin
  if p_key is null or p_key not in ('crm','assigned_candidates_manage','assigned_candidates_overall') or p_actor is null then return false; end if;
  if auth.uid() is not null and auth.uid()<>p_actor then return false; end if;
  if not exists(select 1 from public.employee_statuses where user_id=p_actor::text and status<>'inactive') then return false; end if;
  select * into rule from public.page_view_permissions where page_key=p_key;
  if not found then return private.assigned_candidates_actor_admin(p_actor); end if;
  select exists(select 1 from public.admin_users a join auth.users u on u.id=p_actor where a.user_id=p_actor or lower(a.email)=lower(u.email)),
    exists(select 1 from public.admin_users a join auth.users u on u.id=p_actor where (a.user_id=p_actor or lower(a.email)=lower(u.email)) and (a.role='super_admin' or a.is_super_admin))
    into admin_allowed,super_allowed;
  return coalesce(p_actor=any(rule.allowed_user_ids),false) or case rule.view_permission
    when 'everyone' then true when 'admin_only' then admin_allowed when 'super_admin_only' then super_allowed else false end;
end $$;
revoke all on function private.consultant_resource_actor_allowed(uuid,text) from public,anon,authenticated;
grant execute on function private.consultant_resource_actor_allowed(uuid,text) to service_role;
create function private.assigned_candidates_overall() returns boolean
language sql stable security definer set search_path='' as $$
  select private.consultant_resource_actor_allowed((select auth.uid()),'assigned_candidates_overall');
$$;
revoke all on function private.assigned_candidates_overall() from public,anon;
grant execute on function private.assigned_candidates_overall() to authenticated,service_role;
alter policy assigned_candidates_scoped_read on public.assigned_candidates using (
  (select private.assigned_candidates_access()) and
  (assigned_consultant_id=(select auth.uid()) or (select private.assigned_candidates_admin()) or (select private.assigned_candidates_overall()))
);

create or replace function public.create_assigned_candidates(p_actor uuid, p_rows jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; u public.assigned_candidate_uploads; saved public.assigned_candidates; n integer := 0;
begin
  if not exists (select 1 from public.employee_statuses where user_id = p_actor::text and status <> 'inactive')
    or not private.consultant_resource_actor_allowed(p_actor,'assigned_candidates_manage') then
    raise exception 'Assignment creation access required' using errcode='42501';
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
  elsif not private.assigned_candidates_actor_admin(p_actor) then
    raise exception 'Admin required' using errcode='42501';
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
