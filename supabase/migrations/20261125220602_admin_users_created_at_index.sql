-- Index Advisor recommendation for the admin list's ORDER BY created_at.
-- Non-unique: does not change admin data, role rules, or existing constraints.
set local lock_timeout = '1s';
set local statement_timeout = '10s';
create index if not exists admin_users_created_at_idx
  on public.admin_users using btree (created_at);
