# PMS navigation and Applied Candidates bulk deletion

Implemented locally on `fix/pms-navigation-applied-bulk-delete`, based on
`63567949729d2541e1bc1406c36cf9ca852521e4`. Implementation and verification did not
merge branches, deploy to production, or change live applications, storage, or
database contents. The database migration is included for a separate rollout.

The October 18 followup on `main` removes the deletion recovery panel, its
background lookup, and the corresponding GET endpoint. The table card now fits
its rows instead of reserving 620 px. Horizontal overflow stays inside the table
with no visible scrollbar; touch/trackpad scrolling and focused left/right arrow
keys still reach every column. Loading and empty states fit the visible table
width. With five applications, both Chromium and WebKit measured a 1 px card
border below the last row and a 15 px gap to pagination, with no page horizontal
overflow at 1440, 1024, or 390 px. One-row and empty lists were also checked.

The later formatting restoration uses `ae4b677` as the pre-bulk reference. The
six earlier page versions have the same 21 data columns and no frozen name
column. Those column labels, order, widths, and wrapping are retained, with one
48 px selection column added for bulk deletion. Names now move with the other
columns, and the table has no blue focus outline. Page-specific table rules
override generic table rules regardless of lazy stylesheet load order, avoiding
ellipsis beside checkboxes or clipped long names/roles. The compact height and
hidden scrollbar fixes remain. The built production assets were checked in
Chromium and WebKit using synthetic auth/data, including a late shared stylesheet.

## Column picker and bulk bar update

The filter card, search, role/client/consultant/location fields, dates, datalists,
and Clear Filters action have been removed. List requests now send pagination
and the existing applied-date sort only. The replacement uses the same
`FloatingDropdown`, markup, CSS classes, controls, and preference workflow as
Candidates and Clients: Columns, Proceed, Select All, Clear All, Save Preference,
and Reset to Saved Preference. Browser comparisons confirmed identical rendered
button, action, and checkbox styles across all three pages.

All 21 data columns remain available. Widths, colgroups, headers, rows, loading,
and empty-state colspans follow the active columns. Bulk-selection checkboxes
remain available when data columns are hidden, and changing columns preserves
selected application IDs. Proceed applies pending choices; an empty choice
falls back to all columns, matching the existing pages. Saved choices use the
existing authenticated `/api/user-preferences/appliedCandidatesTableColumns`
GET/PUT routes and local storage fallback. The preference controller binds
requests to the authenticated user. No schema change was needed.

The right-edge movement was reproduced as a 6 px scrollbar-width change in
WebKit. The Applied Candidates route now reserves that scrollbar space, and
dialogs freeze the body at its current position without removing the reserved
scrollbar. Tests keep both the table and top-bar right edge at exactly the same
coordinates through selection, confirmation, and cancel, and verify restoration
of a page scrolled 700 px down.

WebKit also skipped the previous transition, jumping from an offscreen position
to fully visible in its first sampled frame. Both Admin and bulk selection now
use explicit shared 380 ms slide and 220 ms fade keyframes, with the original
easing. The final frames remain in place, avoiding a second transition at the
end. Frame samples confirm continuous upward movement and increasing opacity;
count updates do not restart the entrance. Reduced motion still uses the
existing short fade.

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
shows the mixed state. Column visibility changes preserve selection.
Converting applications have disabled checkboxes with
an accessible explanation. Selection and candidate-name columns scroll normally
with the other columns. The page supports 100 rows per page and a
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

The protected bulk endpoint is:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/applied-candidates/bulk-delete` | Delete explicit `application_ids` with an `operation_id` |

It uses the same authentication and fresh `applied_candidates` page permission
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
items remain selected for retry during the current page session. There is no
deletion recovery option, list, or background lookup after reload.
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
| `npm run test:browser -- --project=chromium --project=webkit` | **38 passed, 0 failed, 0 skipped**, 19 scenarios per engine |
| Production build columns/layout checks, `FYNDBRIDGE_TEST_BUILD=1`, Chromium/WebKit | **12 passed**; preference persistence/error handling, rendered picker comparison, actual Admin/bulk animation frames, stable layout, scroll restoration, original columns and text wrapping |
| ESLint on every changed JS/JSX source and server test, `--max-warnings 0` | Passed, no warnings |
| `git diff --check` | Passed |
| Audit migration in isolated PGlite PostgreSQL | Passed RLS, privileges, service writes, denied browser-role reads, and receipt persistence after actor removal |

Browser scenarios cover idle settling and cold/repeated mouse/keyboard navigation
after editing; employee/quarter changes; score save/reset; completion indicators;
staff refresh/status updates; empty staff; recruiter permissions; individual/page/
mixed selection; selection across pages and column changes; the 100-ID limit;
100-row vertical/horizontal scrolling; dock entrance/count/exit and reduced
motion; narrow-screen dock geometry; hidden keyboard controls; dialog focus and
Escape/cancel; pending/duplicate clicks; conversion races; partial success;
storage failure and immediate retry; absence of recovery UI/requests after reload;
lost-response retry; list/sidebar counts; last-page correction; five/one/zero-row
layout, hidden scrollbars and keyboard scrolling; saved column preferences and
the same picker UI as Candidates/Clients; stable selection/modal geometry and
scroll restoration; actual entrance frames; and unchanged Admin save/cancel behavior. Rendered Admin
and selection dock panel/motion styles were compared and matched.

Backend tests additionally cover unauthorized/forbidden requests, malformed
payloads, missing IDs, duplicate UUIDs, batch/concurrency bounds, invalid staged
paths, adopted candidate guards, audit persistence failure, database cleanup
failure, interrupted completion receipts, and concurrent/idempotent retries.

Current column picker and motion evidence: [verification summary](../outputs/applied-columns-verification/verification-summary.json),
[picker comparison](../outputs/applied-columns-verification/column-ui-comparison.json),
[layout stability](../outputs/applied-columns-verification/layout-stability-webkit.json),
[bulk entrance frames](../outputs/applied-columns-verification/selection-motion-webkit.json),
[Admin entrance frames](../outputs/applied-columns-verification/admin-motion-webkit.json).
Restored formatting evidence: [history and browser checks](../outputs/applied-table-restoration/history-and-layout.json),
[name and role wrapping](../outputs/applied-table-restoration/five-applications-webkit.png),
[final columns](../outputs/applied-table-restoration/final-columns-webkit.png).
Earlier layout evidence: [verification summary](../outputs/applied-layout-verification/verification-summary.json),
[five applications in WebKit](../outputs/applied-layout-verification/five-applications-webkit.png).
Original implementation evidence: [verification summary](../outputs/pms-applied-verification/verification-summary.json),
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

- [Column picker matching Candidates and Clients, WebKit](../outputs/applied-columns-verification/column-picker-webkit.png)
- [Applied column choices, WebKit](../outputs/applied-columns-verification/selected-columns-webkit.png)
- [Bulk-delete bar, WebKit](../outputs/applied-columns-verification/bulk-delete-bar-webkit.png)

Earlier formatting snapshots are retained below:

- [Restored formatting with long names and roles, WebKit](../outputs/applied-table-restoration/five-applications-webkit.png)
- [Final columns after horizontal scrolling, WebKit](../outputs/applied-table-restoration/final-columns-webkit.png)

The earlier compact-layout snapshots are retained for comparison:

- [Five applications, Chromium](../outputs/applied-layout-verification/five-applications-chromium.png)
- [Five applications, WebKit](../outputs/applied-layout-verification/five-applications-webkit.png)
- [Empty list, WebKit](../outputs/applied-layout-verification/empty-applications-webkit.png)

The following snapshots show the original implementation before this followup:

- [Floating selection bar](../outputs/pms-applied-verification/selection-bar.png)
- [Confirmation dialog](../outputs/pms-applied-verification/confirmation-dialog.png)
- [Partial result and selected retry item](../outputs/pms-applied-verification/partial-result-and-retry.png)
- [Small-screen dock](../outputs/pms-applied-verification/selection-bar-mobile.png)

## Changed files

The original source, test, migration, documentation, and evidence list is in
[changed-files.txt](../outputs/pms-applied-verification/changed-files.txt).

| Files | Change |
| --- | --- |
| `src/hooks/useStaffDirectory.js` | Stable directory arrays with live status updates |
| `src/pages/PerformanceReviewPage.jsx` | Derived selector options and account-aware selection |
| `src/components/Sidebar.jsx` | Removed the PMS pointer workaround |
| `src/pages/AppliedCandidatesPage.jsx`, `.css` | Selection, column picker replacing all filters, dynamic table, compact layout and reserved scrollbar |
| `src/utils/appliedCandidateTableColumns.js` | Stable column keys, labels, widths and saved-preference normalization |
| `src/utils/lockBodyScroll.js` | Freeze and restore the current scroll position while preserving table width |
| `src/components/AppliedCandidateBulkDelete.jsx` | Selection dock, native confirmation and preserved scroll position |
| `src/components/FloatingActionDock.jsx`, `.css` | Shared portal panel, motion, inert visibility |
| `src/pages/AdminPage.jsx`, `.css` | Reused shared dock styles with existing save/cancel handlers |
| `src/services/appliedCandidatesApi.js` | Bulk-delete API; removed recovery method |
| `server/src/routes/appliedCandidates.js` | Authenticated bulk route; removed recovery route |
| `server/src/controllers/appliedCandidatesController.js` | Bulk request handler; removed recovery handler |
| `server/src/services/appliedCandidates.js` | Reused cleanup with pre-cleanup receipt hook and adopted-record guards |
| `server/src/services/appliedCandidateDeletion.js` | Validation, bounded execution, receipts and outcomes; removed recovery listing |
| `supabase/migrations/20261018064757_applied_candidate_deletion_audit.sql` | RLS-protected service-only deletion ledger |
| `server/src/services/appliedCandidateDeletion.test.js` | Service/race/retry/security/real-route coverage |
| `server/src/services/uiLoadingNavigationRegression.test.js` | Removed obsolete workaround-only assertion |
| `server/test-support/appliedCandidatesMemory.cjs` | Isolated database/storage test adapter |
| `server/browser-tests/fixtures.cjs` | Mock auth/API boundary with real deletion and user preference backend |
| `server/browser-tests/pms-applied.spec.cjs` | Thirteen browser scenarios per engine |
| `server/browser-tests/applied-columns.spec.cjs` | Five picker/persistence/UI/motion/layout/scroll scenarios per engine |
| `server/browser-tests/applied-layout.spec.cjs` | Short/empty geometry, all historical columns, normal name scrolling, no outline, long text and late shared CSS |
| `server/browser-tests/staff-harness.html` | Real hook reference/status/refresh verification |
| `server/browser-tests/vite.config.mjs` | Test server without an API proxy |
| `server/browser-tests/baseline-diagnostic.cjs` | Original-commit reproduction helper |
| `playwright.config.cjs`, `package.json`, `package-lock.json` | Locked browser tooling, test command, browser matrix and optional production-build layout verification |
| `outputs/pms-applied-verification/*` | Synthetic screenshots and recorded verification evidence |
| `outputs/applied-layout-verification/*` | Followup layout screenshots, measurements and check results |
| `outputs/applied-table-restoration/*` | Historical column comparison and production-build formatting evidence |
| `outputs/applied-columns-verification/*` | Current column picker screenshots, real animation frames, layout stability and verification results |
