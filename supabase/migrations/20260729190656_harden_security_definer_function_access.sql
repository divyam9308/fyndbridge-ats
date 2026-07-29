create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_current_employee_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select status <> 'inactive'
    from public.employee_statuses
    where user_id = (select auth.uid())::text
  ), false);
$$;

revoke all on function private.is_current_employee_active()
  from public, anon, authenticated, service_role;
grant execute on function private.is_current_employee_active()
  to authenticated;

alter policy employee_statuses_authenticated_read
  on public.employee_statuses
  using (
    user_id = (select auth.uid())::text
    or (select private.is_current_employee_active())
  );

alter policy page_view_permissions_select_authenticated
  on public.page_view_permissions
  using ((select private.is_current_employee_active()));

drop function public.is_current_employee_active();

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

revoke all on function public.next_invoice_display_id()
  from public, anon, authenticated, service_role;
grant execute on function public.next_invoice_display_id()
  to service_role;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
      and cmd.schema_name in ('public')
      and cmd.schema_name not in ('pg_catalog', 'information_schema')
      and cmd.schema_name not like 'pg_toast%'
      and cmd.schema_name not like 'pg_temp%'
    then
      begin
        execute format(
          'alter table if exists %s enable row level security',
          cmd.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log
        'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity,
        cmd.schema_name;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated, service_role;

drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
