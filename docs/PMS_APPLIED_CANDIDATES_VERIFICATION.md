# PMS navigation and Applied Candidates bulk deletion

Implemented locally on `fix/pms-navigation-applied-bulk-delete`, based on
`63567949729d2541e1bc1406c36cf9ca852521e4`. Implementation and verification did not
merge branches, deploy to production, or change live applications, storage, or
database contents. The database migration is included for a separate rollout.

## PMS cause and fix

`useStaffDirectory` mapped the cached directory on every render. The new array
retriggered the Super Admin selector effect, which scheduled another zero-delay
timer and copied the options into state. That state update recreated the array
and continued the cycle. React's pending route transition could change the URL
while leaving PMS rendered until another urgent interaction occurred.

The merged and selectable staff arrays are now memoized against the current
directory snapshot and employment-status map. PMS derives employee options with
`useMemo`; both selector-copying timer effects were removed. Selection is tied to
the signed-in user and falls back to that user when an employee disappears. Staff
refreshes, status changes, and selection across directory updates are covered by
browser checks. Review fetching, caching, scoring, and save/reset logic remain in
place.

The PMS-specific pointer navigation workaround was removed after testing normal
React Router navigation. Its old source-string test was replaced by real browser
coverage.

An isolated original-commit replay, using the same application dependencies,
recorded **1,738 idle React commits in 1.2 seconds**. After clicking Applied
Candidates, the URL changed but PMS was still visible after 5.1 seconds. Clicking
Q4 released the navigation. The fixed version recorded **zero idle commits** in
the same interval. A cold route completed in **883 ms**, including an intentional
350 ms destination-module delay. These are diagnostic observations from a local
development browser, not production performance guarantees or thresholds.

Evidence: [original metrics](../outputs/pms-applied-verification/original-pms-navigation-metrics.json),
[fixed metrics](../outputs/pms-applied-verification/pms-navigation-metrics.json),
[original delayed view](../outputs/pms-applied-verification/original-pms-delayed-navigation.png),
[completed navigation](../outputs/pms-applied-verification/pms-navigation-completed.png).

## Bulk deletion behavior and permission model

Selection uses application UUIDs and survives pagination and scrolling. The
header checkbox selects eligible applications on the current page only and
shows the mixed state. Search and filters clear the selection, including the
debounced search boundary. Converting applications have disabled checkboxes with
an accessible explanation. Both selection and candidate-name columns stay
visible during horizontal scrolling. The page supports 100 rows per page and a
maximum selection of 100 explicit application IDs.

`FloatingActionDock` shares the former Admin save-dock panel styles, portal,
24 px corners, border, shadow, spacing, and 380/220 ms transitions. Admin's save
and cancel handlers remain intact. The destructive action uses a red button.
The dock stays mounted for exit animation, becomes inert while hidden, and
updates its count without restarting its entrance. It accounts for the desktop
sidebar, small viewports, bottom spacing, safe areas, and reduced motion.

The native modal dialog provides focus containment, an accessible name and
description, Escape/cancel, and focus restoration. It states the selected count,
permanent application/staged-CV deletion, and preservation of candidate master
records and adopted CVs. Busy state and an immediate ref guard prevent duplicate
submissions. There is no Undo promise.

The new protected endpoints are:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/applied-candidates/bulk-delete` | Delete explicit `application_ids` with an `operation_id` |
| `GET /api/applied-candidates/deletion-failures` | Discover incomplete cleanup, including rejected rows outside the pending list |

Both use the same authentication and fresh `applied_candidates` page permission
as existing rejection. This feature is available to permitted ordinary
recruiters; it does not require Admin status or grant additional access.

The server validates shape, UUIDs, duplicates, and a 1–100 batch size, with at
most four applications processing concurrently. It reuses the rejection service
and its conditional `pending -> rejected` claim. Conversion status and adopted
candidate/association markers are rechecked, and only the exact staged path in
the `public-applications` bucket may be removed. It never deletes master
candidates, adopted CVs, or mandate associations.

A service-only deletion ledger records application/operation UUIDs, actors,
state, and timestamps before irreversible cleanup. It stores no applicant name,
email, CV path, or CV contents. Cleanup markers and receipts support retries
after storage/database errors, process interruption, and lost responses. Failed
items remain selected and appear in a persistent recovery list after reload.
Successful and skipped IDs leave selection. The UI shows exact deleted/skipped/
failed counts, refreshes list totals and sidebar counts, and clamps pagination.

## Verification results

All browser application data and authentication were synthetic. The test browser
uses a Vite configuration with **no API proxy**. Protected Applied Candidates
requests are routed to the actual Express router/controller/service against an
isolated in-memory database and storage adapter. No production applications or
CVs were used to test deletion.

| Check | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm --prefix server test` | **727 passed, 0 failed** |
| New deletion-service and real-route tests | **9 passed** within the server suite |
| `npm run test:browser -- --project=chromium --project=webkit` | **26 passed, 0 failed, 0 skipped**, 13 scenarios per engine |
| ESLint on every changed JS/JSX source and server test, `--max-warnings 0` | Passed, no warnings |
| `git diff --check` | Passed |
| Audit migration in isolated PGlite PostgreSQL | Passed RLS, privileges, service writes, denied browser-role reads, and receipt persistence after actor removal |

Browser scenarios cover idle settling and cold/repeated mouse/keyboard navigation
after editing; employee/quarter changes; score save/reset; completion indicators;
staff refresh/status updates; empty staff; recruiter permissions; individual/page/
mixed selection; selection across pages and scope changes; the 100-ID limit;
100-row vertical/horizontal scrolling; dock entrance/count/exit and reduced
motion; narrow-screen dock geometry; hidden keyboard controls; dialog focus and
Escape/cancel; pending/duplicate clicks; conversion races; partial success;
storage failure/recovery after reload; lost-response retry; list/sidebar counts;
last-page correction; and unchanged Admin save/cancel behavior. Rendered Admin
and selection dock panel/motion styles were compared and matched.

Backend tests additionally cover unauthorized/forbidden requests, malformed
payloads, missing IDs, duplicate UUIDs, batch/concurrency bounds, invalid staged
paths, adopted candidate guards, audit persistence failure, database cleanup
failure, interrupted completion receipts, and concurrent/idempotent retries.

Evidence: [verification summary](../outputs/pms-applied-verification/verification-summary.json),
[Admin dock comparison](../outputs/pms-applied-verification/admin-dock-comparison.json),
[migration checks](../outputs/pms-applied-verification/migration-verification.json).

## Limitations and rollout prerequisite

The migration
`supabase/migrations/20261018064757_applied_candidate_deletion_audit.sql` must be
reviewed and applied to the intended environment before using bulk deletion
there. It was generated with the Supabase CLI and tested only in isolated
PostgreSQL. No live Supabase schema or storage integration was mutated or tested
destructively.

Full `npm run lint` remains red with pre-existing issues: 886 errors and three
warnings including generated `.vercel` output. Excluding generated output,
both the original snapshot and current source have 41 errors; warnings decreased
from four to three. Comparing normalized rule/messages introduced no new source
lint findings. Every changed JS/JSX source file passes strict lint independently.

Dependency audits are unchanged from the original lockfiles: frontend two
moderate and six high findings; server three moderate, two high, and one critical
finding. The critical server finding is in `proxy-addr`. No production dependency
upgrades were included in this focused change. Playwright was added as an exact,
locked development dependency.

Firefox did not complete verification on this macOS host. Its stock browser
failed before the tests with `Could not find profile folder`; a separate temporary
application-identity experiment also encountered a page crash. These attempts
are not counted as passing browser coverage. The full configured three-engine
command may therefore fail on this host; the explicit Chromium/WebKit command
above passes. No system browser settings or installed browser bundle were changed.

The small-screen check establishes that the dock and dialog fit and remain usable
at 390 px. The existing app still has its permanent desktop sidebar and a wide,
horizontally scrollable candidate table; app-wide mobile navigation was outside
these two changes.

## Screenshots

- [Floating selection bar](../outputs/pms-applied-verification/selection-bar.png)
- [Confirmation dialog](../outputs/pms-applied-verification/confirmation-dialog.png)
- [Partial result and selected retry item](../outputs/pms-applied-verification/partial-result-and-retry.png)
- [Small-screen dock](../outputs/pms-applied-verification/selection-bar-mobile.png)

## Changed files

The complete source, test, migration, documentation, and evidence list is in
[changed-files.txt](../outputs/pms-applied-verification/changed-files.txt).

| Files | Change |
| --- | --- |
| `src/hooks/useStaffDirectory.js` | Stable directory arrays with live status updates |
| `src/pages/PerformanceReviewPage.jsx` | Derived selector options and account-aware selection |
| `src/components/Sidebar.jsx` | Removed the PMS pointer workaround |
| `src/pages/AppliedCandidatesPage.jsx`, `.css` | Selection, sticky columns, dock/dialog integration, recovery/results, pagination |
| `src/components/AppliedCandidateBulkDelete.jsx` | Selection dock content and accessible native confirmation |
| `src/components/FloatingActionDock.jsx`, `.css` | Shared portal panel, motion, inert visibility |
| `src/pages/AdminPage.jsx`, `.css` | Reused shared dock styles with existing save/cancel handlers |
| `src/services/appliedCandidatesApi.js` | Bulk-delete and recovery API methods |
| `server/src/routes/appliedCandidates.js` | Authenticated bulk/recovery routes |
| `server/src/controllers/appliedCandidatesController.js` | Bulk/recovery request handlers |
| `server/src/services/appliedCandidates.js` | Reused cleanup with pre-cleanup receipt hook and adopted-record guards |
| `server/src/services/appliedCandidateDeletion.js` | Validation, bounded execution, receipts, outcomes, recovery |
| `supabase/migrations/20261018064757_applied_candidate_deletion_audit.sql` | RLS-protected service-only deletion ledger |
| `server/src/services/appliedCandidateDeletion.test.js` | Service/race/retry/security/real-route coverage |
| `server/src/services/uiLoadingNavigationRegression.test.js` | Removed obsolete workaround-only assertion |
| `server/test-support/appliedCandidatesMemory.cjs` | Isolated database/storage test adapter |
| `server/browser-tests/fixtures.cjs` | Mock auth/API boundary with real deletion backend |
| `server/browser-tests/pms-applied.spec.cjs` | Thirteen browser scenarios per engine |
| `server/browser-tests/staff-harness.html` | Real hook reference/status/refresh verification |
| `server/browser-tests/vite.config.mjs` | Test server without an API proxy |
| `server/browser-tests/baseline-diagnostic.cjs` | Original-commit reproduction helper |
| `playwright.config.cjs`, `package.json`, `package-lock.json` | Locked browser tooling, test command, browser matrix |
| `outputs/pms-applied-verification/*` | Synthetic screenshots and recorded verification evidence |
