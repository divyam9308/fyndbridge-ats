# Performance audit and safe implementation plan

## Scope and evidence

Current production row counts (about 65 candidates, 32 clients, and 21 jobs) are expected. They are not a missing-data issue. This audit is repository-based; query plans, live policy definitions, index usage since restart, and Supabase advisor results must be rechecked after deployment.

## Current likely causes

- **Sequential scans:** PostgreSQL reads a whole table when that is cheaper than using an index. At this data size this is normally cheap; high cumulative counts point more strongly to repeated requests than to table size.
- **Temporary files/bytes:** PostgreSQL spilled sort, hash, or materialized intermediate data to disk. The 30 GB figure is cumulative, so it needs a time-window comparison with slow-query logs before attribution.
- **RLS auth re-evaluation:** direct `auth.uid()`/`auth.jwt()` expressions can be evaluated per candidate row. A scalar subquery lets PostgreSQL evaluate them once per statement without changing the authorization result.
- **Duplicate indexes:** two identical unique indexes make writes do the same index maintenance twice and consume memory/disk.
- **Unused indexes:** the statistics are cumulative and can reset; an unused index is not automatically safe to remove.
- **Repeated frontend/backend fetches:** list pages have pagination, but option lists and realtime refreshes can add requests. Dashboard currently issued three redundant recent-activity reads.
- **Realtime subscription duplication:** current shared subscription hook has stable table keys and cleanup. Its callers still need to keep a stable channel name and callback.
- **Notification polling:** there is no interval polling in the bell; it performs an initial load and uses one per-user realtime subscription.
- **Dashboard recalculation:** dashboard analytics read complete source sets and aggregate in Node. At current size this is safe, but it is the main future scale risk. It also made three redundant reads for recent activity.

## Change list

| Change | Files | Area | Risk | Expected benefit | Rollback |
| --- | --- | --- | --- | --- | --- |
| Remove redundant dashboard recent-activity queries | `server/src/controllers/dashboardController.js` | Backend | Low | Three fewer Supabase reads per dashboard request; response stays identical because activity is already derived from the complete fetched sets. | Restore the three queries. |
| Add opt-in, non-sensitive API timing logs | `server/src/app.js` | Backend | Low | Measures route/method/request-id/duration for the relevant API routes. | Remove middleware. |
| Add opt-in frontend request timing | `src/services/apiClient.js` | Frontend | Low | Identifies duplicate requests without logging records or credentials. | Remove tracing block. |
| Cache `auth.*` calls inside existing RLS policies | `supabase/migrations/202606250001_rls_auth_initplan.sql` | Database | Low | Avoids per-row auth/session evaluation; policy predicates remain equivalent. | Run the documented rollback SQL. |
| Remove only a runtime-proven duplicate follow-up index | `supabase/migrations/202606250002_drop_proven_duplicate_client_follow_up_index.sql` | Database | Low | Avoids duplicate index maintenance. Runtime guards skip the drop unless definitions match and neither index backs a constraint. | Recreate the documented index. |

No new query indexes are proposed. Current list routes paginate normal views; their `%text%` `ilike` searches cannot use ordinary btree indexes. Consider `pg_trgm` only after slow-query logs show substring search is material and extension availability is confirmed. No columns or tables are removed.

## DB migration plan

### `202606250001_rls_auth_initplan.sql`

Changes policies on `profiles`, `user_profiles`, `notifications`, `invoice_entities`, `invoices`, and `invoice_pdf_versions` from direct calls such as `auth.uid()` to `(select auth.uid())`; invoice email checks similarly use `(select auth.jwt())`. It does not change roles, operations, table grants, columns, or predicate logic, so it does not weaken RLS or remove user data.

Exact migration SQL:

```sql
alter policy "profiles_select_own" on public.profiles using (id = (select auth.uid()));
alter policy "profiles_insert_own" on public.profiles with check (id = (select auth.uid()));
alter policy "profiles_update_own" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "user_profiles_select_own" on public.user_profiles using (user_id = (select auth.uid())::text);
alter policy "user_profiles_insert_own" on public.user_profiles with check (user_id = (select auth.uid())::text);
alter policy "user_profiles_update_own" on public.user_profiles using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);
alter policy notifications_select_own on public.notifications using (recipient_user_id = (select auth.uid()));
alter policy notifications_update_own_read_state on public.notifications using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));
```

The invoice policies use the same replacement inside their existing `exists (select 1 from public.admin_users ...)` check. Full executable SQL is in the migration.

Rollback: replace each `(select auth.uid())` with `auth.uid()` and `(select auth.jwt())` with `auth.jwt()` in the same `alter policy` statements. This is reversible metadata-only SQL.

### `202606250002_drop_proven_duplicate_client_follow_up_index.sql`

Repository definitions show both indexes are unique on `(client_id, follow_up_date)`. The migration independently verifies the table, key columns, uniqueness, predicate/expression/access properties, and absence of dependent constraints before dropping only `client_follow_ups_client_date_unique_idx`. If any check fails it raises a notice and changes nothing. It removes no user data and does not affect RLS/security.

Rollback SQL:

```sql
create unique index concurrently if not exists client_follow_ups_client_date_unique_idx
  on public.client_follow_ups (client_id, follow_up_date);
```

`create index concurrently` cannot run inside a transaction; use it as a standalone Supabase SQL command if rollback is needed.

## Audited behavior and deferred work

- Candidates, clients, and jobs have server pagination for normal paths. Candidate associations and client follow-ups are batched, not fetched N+1 per table row. Protected document URLs are opened on demand.
- Jobs consultant filtering and AI keyword paths still perform local filtering after a larger read. This preserves current multi-consultant semantics; moving it to SQL needs a measured query plan and data-format decision.
- Dashboard calculations still aggregate in Node from complete datasets. With current data this is acceptable; move to SQL/RPC only after measuring actual slow queries, because status normalization and consultant-list parsing currently live in JavaScript.
- Notification clear/read mutations are optimistic and realtime updates merge/remove rows; no polling loop exists. Server-side due-notification generation happens on list load and is protected by the existing unique follow-up notification index.
- Realtime channels use cleanup. No changes are needed unless browser tracing shows duplicate subscriptions in a specific route.
- Invoice/entity and admin fetch loops were not found in render paths. Admin enforcement remains server-side.

## Deployment and monitoring

Apply migrations with the Supabase migration workflow after reviewing this report. Do not run the rollback unless a regression is observed.

Compare before/after over the same workload window:

- Browser Network: one dashboard request on mount (development Strict Mode may show an aborted request), no recurring notification requests while idle, and one realtime websocket subscription per mounted surface.
- Backend logs with `DEBUG_PERF=true`: request id and duration for candidates, clients, jobs, dashboard, notifications, invoice, and admin routes.
- Supabase: slow-query logs, `pg_stat_statements` mean/total time and temp blocks, `pg_stat_database.temp_files/temp_bytes`, `pg_stat_user_tables.seq_scan`, `pg_stat_user_indexes.idx_scan`, and RLS advisor results.

Do not infer a RAM improvement from these changes. Database memory, temp usage, and advisor findings require post-deploy measurement.
