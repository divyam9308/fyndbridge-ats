# Stable assignment status ordering — 19 October 2026

Ordinary unadded statuses share database sort group 0 and preserve `assigned_at,id` order. Didn’t Pick Up uses group 1, Not Relevant group 2, and successfully Added records group 4. Presentation colors remain white/grey, yellow, red and green respectively. Existing KPI/deletion rules and main Candidates status options are unchanged.

Not Relevant cannot enter single/bulk transfer. Both API review/transfer and the row-locked database transaction reject its authoritative stored status. A stale Add form submitting Interested cannot bypass the guard. Updating a selected row immediately updates bulk-transfer eligibility even if the row moves off the current page.

## Verification

- Full Assigned Candidates browser suite: 46 passed (23 Chromium, 23 WebKit).
- Full backend suite: 790 passed.
- Frontend utility/attendance suite: 14 passed.
- Changed-file ESLint: passed.
- Production build: passed.
- Repository-wide ESLint: 885 errors and 3 warnings in existing files outside this change; no unrelated remediation included.
- Screenshot: `stable-status-order.png` shows the transferred Interested row in the final green group on page 2. Browser checks also compare full page order before/after ordinary status changes and after reload, test immediate excluded-group movement, disabled single/bulk actions, API rejection and stale form rejection.

## Hosted database

Applied `20261019121623_assigned_candidate_stable_status_order.sql` to the verified ATS FYNDBRIDGE project. PostgreSQL generated-expression replacement preserves the existing sort column and indexes. Live rollback smoke covered Not Contacted, Interested, In Discussion, Not Interested, Didn’t Pick Up and Not Relevant, stable assignment timestamps, no main candidate writes for blocked statuses, and all 17 assignment records preserved. RLS is enabled; transfer execution is denied to anon/authenticated and allowed to service_role.

Security advisors returned existing warnings for [assign_client_display_id search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Backend-only upload/CRM tables remain deny-by-default with RLS and no direct client policies. No new transfer-function advisory was reported.

Browser verification uses synthetic records with the real React application, Express routes and isolated PostgreSQL. It does not verify deployed Auth/Storage or real-user acceptance. Hosted smoke changes were rolled back; no test candidates were retained.
