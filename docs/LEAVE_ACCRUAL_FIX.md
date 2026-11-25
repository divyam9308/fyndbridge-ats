# Leave accrual duplicate errors

Balance reads previously retried plain inserts for every eligible month and
ignored PostgreSQL `23505` errors. The unique index prevented extra leave, but
each read generated duplicate errors in the database logs.

`attendanceService` now calls `insert_leave_ledger_credit` for monthly accruals
and annual opening balances. The service-only, security-invoker function uses
`ON CONFLICT DO NOTHING` with the existing partial unique indexes. Existing
amounts, descriptions and timestamps are retained. Unexpected database errors
are returned to the service instead of being ignored.

Eligibility, 1.5-day monthly credits, accrual dates and the five-day carry-forward
cap are unchanged. This migration defines a function and permissions only; it
does not update or remove historical ledger entries. Historical eligibility
exceptions require separate review.

Apply `20261125214831_leave_ledger_credit_insert_once.sql` before deploying the
application change. The function is additive and can coexist with the previous
backend during rollout. Do not deploy the new backend before this migration.

Verification uses the actual migration and existing ledger table/index SQL in
isolated PostgreSQL (PGlite). Tests cover duplicate calls preserving rows,
zero/nonzero opening balances, other constraint failures, backend-only execution,
real balance-service catch-up/reloads, carry-forward, and RPC failure propagation.
PGlite serializes queries; overlapping calls in these tests do not simulate
independent PostgreSQL sessions. Conflict handling itself is a single database
insert protected by the existing unique index.

Focused command:

```sh
node --test server/src/services/leaveLedgerCredits.test.js server/src/services/attendanceUtils.test.js server/src/services/attendanceLeaveEligibility.test.js server/src/services/employmentRoster.test.js server/src/services/inactiveEmployeeFlows.test.js
```

Validation on 26 November 2026: 33 focused tests, all 960 backend tests, and all
28 frontend unit tests passed. Focused lint, production build and whitespace
checks passed. No dependencies or UI code changed.

Hosted rollout: applied to `ATS FYNDBRIDGE` (`owheruvatjcfqwsejnmo`), recorded by
Supabase as version `20261125215244`. All 192 repeated calls over the existing
64 monthly credits returned “not inserted.” The complete ledger remained at
181 rows with the same checksum before and after. Hosted execution permissions
exclude `anon` and `authenticated`; `service_role` is allowed. Security advisors
showed the same pre-existing findings and no new ones.
