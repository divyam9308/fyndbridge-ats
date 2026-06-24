-- Keeps existing policy logic identical while allowing auth/session values to be
-- evaluated once per statement instead of once per candidate row.
alter policy "profiles_select_own" on public.profiles using (id = (select auth.uid()));
alter policy "profiles_insert_own" on public.profiles with check (id = (select auth.uid()));
alter policy "profiles_update_own" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy "user_profiles_select_own" on public.user_profiles using (user_id = (select auth.uid())::text);
alter policy "user_profiles_insert_own" on public.user_profiles with check (user_id = (select auth.uid())::text);
alter policy "user_profiles_update_own" on public.user_profiles using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

alter policy notifications_select_own on public.notifications using (recipient_user_id = (select auth.uid()));
alter policy notifications_update_own_read_state on public.notifications using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

alter policy invoice_entities_admin_all on public.invoice_entities
  using (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')))
  with check (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')));

alter policy invoices_admin_all on public.invoices
  using (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')))
  with check (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')));

alter policy invoice_pdf_versions_admin_all on public.invoice_pdf_versions
  using (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')))
  with check (exists (select 1 from public.admin_users where user_id = (select auth.uid()) or lower(email) = lower((select auth.jwt()) ->> 'email')));
