# CRM Gmail contact search and timeline rollout — 23 October 2026

The optimized sync and one-time queue maintenance were deployed to Supabase project
`owheruvatjcfqwsejnmo` and Vercel project `fyndbridge-ats`. Production deployment:
`dpl_GNtEhyVFCvzueRyw9cc16HZtRqn4`, serving https://fyndbridge-ats.vercel.app.
Source was verified in `/tmp/fyndbridge-gmail-contact-sync` from base
`fead161f19982961c814ba9f02a7ad994262e008` with local changes. No commit or push was made.
The existing uncommitted Gmail/client-import work was retained and reconciled with
this task. The verified files were integrated back into the shared checkout after
checking that those files had stopped changing. Their prior state is preserved in
`/tmp/fyndbridge-gmail-before-verified-integration`. No Candidates, Clients, Mandates, invoices, attendance or reporting source changed.

## Final behavior

- Sync now searches every currently valid CRM contact address across connected
  mailboxes. One address per deterministic query batch keeps query and encoded URL
  size bounded. Every batch includes From, To, Cc and Bcc, the fixed historical upper
  bound, and the existing spam/trash/draft exclusions.
- The database persists the normalized snapshot, scan UUID, batch index and page
  token. A contact-set change invalidates the old cursor, keeps the cutoff and
  restarts the snapshot safely. A stale page is discarded. An expired Gmail token
  restarts that batch, with message-ID deduplication. No historical full-mailbox fallback exists.
- Metadata is matched against current contacts before fetching full messages and
  again before Gemini. All organisations participate in ambiguity checks. The
  insert transaction serializes contact edits and validates exact current ownership.
- Client-specific import jobs retain the exact discovery address. A transferred
  address can belong to its current organisation; a message not involving the
  selected query address is rejected. Legacy jobs retain their client guard.
- Imported activities and permanent failures are never reanalysed by rediscovery.
  Previously unrelated completed jobs may be reconsidered in a fresh contact scan.
- `occurred_at` stores original Gmail event time; the RFC Date header is preferred,
  with `internalDate` fallback. Existing activities backfill from saved `email_at`.
  `created_at` remains the insertion/audit timestamp. Manual events use creation time.
- Activity History orders by `(occurred_at DESC, id DESC)` in the database before
  its existing 25-row pagination. Gmail cards have one original-date label in the
  existing IST format. Colours, insights, receipts, comments and permissions remain intact.
- Incremental Gmail history, OAuth credentials, rate limits, AI configuration,
  retry delays, concurrency and both cron schedules are preserved.

## Production maintenance and ordering

The following artifacts were applied through Supabase migrations. The hosted MCP
runner assigned the execution-time versions below; the local filenames now match
those recorded versions. The tested SQL content is unchanged. Inspect migration
history before any future CLI push because this project already had older Gmail
schema changes present without corresponding history rows before this task.

| Order | Local artifact | Hosted version |
| --- | --- | --- |
| 1 | `20261023112550_crm_gmail_shared_sync_and_client_history.sql` | `20261023112550` |
| 2 | `20261023112559_crm_gmail_contact_search_and_event_time.sql` | `20261023112559` |
| 3 | `20261023112611_crm_gmail_explicit_history_modes.sql` | `20261023112611` |
| 4 | `20261023112632_crm_gmail_obsolete_queue_cleanup.sql` | `20261023112632` |

Protocol v2 closed the legacy worker/backfill commit RPCs before maintenance.
Every discovery/job claim additionally requires the active global worker lease.
Cleanup locked worker → connections → imports → jobs, revoked leases, removed
connected-account pending/retryable/processing jobs, discarded obsolete unfinished
import cursors, and initialized fresh current-contact historical snapshots. A
persistent `contact_queue_cleaned_at` marker prevents a second cleanup. Application
startup, scheduled workers and manual sync never execute this maintenance operation.

At cleanup time there were 5,292 pending jobs, 615 completed jobs and 19 permanent
failures. The pending queue became empty; the 615 completed jobs and all 19 permanent
failures remained. The two connections, encrypted credentials and incremental
checkpoint fields had the same before/after hash. All eight existing activities
retained identical content and audit timestamps (excluding the newly backfilled
`occurred_at`). The migration contains assertions that abort the transaction if
preservation fails. No Gmail message deletion or Gmail write API was used.

After cleanup, the reviewed application was deployed. Both connected mailboxes
completed their two current-contact query batches. New valid activities were
created, and the original eight activity hashes remained unchanged. One ordinary
`crm_gmail_schedule()` invocation requested the normal incremental cycle as a
production verification; cron configuration was not changed. Final live results
are recorded in `outputs/crm-contact-sync-verification/live-results.json`.

## Verification

- All 65 focused CRM/Gmail backend tests passed with isolated PGlite databases and
  synthetic Gmail/Gemini providers, including full migration-chain and one-time
  cleanup checks, revoked-worker claims, contact transfers and original-date backfill.
- All 46 CRM/Gmail browser cases passed in Chromium/WebKit against a production
  build with synthetic authentication and APIs. The initial run had one WebKit
  duplicate-dialog timing failure; its focused retry passed. Original-date rendering,
  database order across 25-row boundaries, deduplication, receipts, toolbar feedback,
  permissions and existing ATS table/form rendering were exercised.
- Production build passed. Changed-file ESLint passed except the pre-existing
  `react-hooks/refs` finding at `CrmDialogs.jsx:130`, independently reproduced from HEAD.
  `git diff --check` passed.
- The broader server run had 863 passing and three failing tests. The failures
  reproduce independently in untouched Candidates pagination and consultant-access
  test areas (a stale dependency-array source assertion and an existing 404/403
  expectation mismatch). These were not changed within this Gmail task.
- Hosted checks confirm all Gmail RPCs are SECURITY INVOKER, have a fixed search
  path and deny browser-role execution. The new operational import table has RLS
  and service-only grants. Advisor warning counts are unchanged; its additional
  RLS/no-policy informational entry is intentional for this service-only table.
- Both preview and production `/api/health` returned HTTP 200. Real OAuth consent
  was not repeated, and real email contents were not inspected for this report.

The complete list of changed source, tests, migrations and documentation is in
`outputs/crm-contact-sync-verification/changed-files.json`. Synthetic screenshots
and logs are verification artifacts, not changes to unrelated ATS functionality.

## Final live result

Observed at 2026-10-23 11:34:05 UTC: both historical scans and both incremental
cycles completed; zero obsolete queued jobs, zero duplicate Gmail activities, two
connected mailboxes and three Gmail activities (two new imports). All eight
original activity hashes and all 19 permanent-failure diagnostics are unchanged.
The cleanup has exactly one migration-history entry.

One newly discovered current-contact job is on the unchanged automatic retry
schedule after `INVALID_AI_OUTPUT` (two attempts; next eligible at 11:36:32 UTC).
It is a fresh, valid-contact job rather than obsolete queue residue. Gemini prompts,
models, validation and retry delays were intentionally preserved.

Follow-up: at the user's explicit request, the single `INVALID_AI_OUTPUT` retry
job was removed. The active queue was verified empty, with activity and connection
counts unchanged and all 19 older permanent-failure diagnostics preserved. No
migration was rerun. The earlier live-results artifact remains a timestamped
snapshot taken before this follow-up.
