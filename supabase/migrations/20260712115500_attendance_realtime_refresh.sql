drop policy if exists attendance_records_admin_realtime_read on public.attendance_records;
create policy attendance_records_admin_realtime_read on public.attendance_records
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) or lower(a.email) = lower((select auth.jwt()) ->> 'email')));

drop policy if exists corrections_admin_realtime_read on public.attendance_correction_requests;
create policy corrections_admin_realtime_read on public.attendance_correction_requests
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) or lower(a.email) = lower((select auth.jwt()) ->> 'email')));

drop policy if exists leaves_admin_realtime_read on public.leave_requests;
create policy leaves_admin_realtime_read on public.leave_requests
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) or lower(a.email) = lower((select auth.jwt()) ->> 'email')));

drop policy if exists ledger_admin_realtime_read on public.leave_ledger;
create policy ledger_admin_realtime_read on public.leave_ledger
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()) or lower(a.email) = lower((select auth.jwt()) ->> 'email')));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_records') then
    alter publication supabase_realtime add table public.attendance_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_correction_requests') then
    alter publication supabase_realtime add table public.attendance_correction_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_requests') then
    alter publication supabase_realtime add table public.leave_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leave_ledger') then
    alter publication supabase_realtime add table public.leave_ledger;
  end if;
end $$;
