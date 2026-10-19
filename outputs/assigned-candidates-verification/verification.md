# Assigned Candidates verification

Date: 19 October 2026 (Asia/Kolkata).
Checkout: `/Users/divyamaggarwal/Desktop/files/fyndbridge ats/fyndbridge-ats`, branch `main`, remote `divyam9308/fyndbridge-ats`. The checkout was clean before implementation. All screenshots and test records use synthetic Test/Example data.

## Implemented and tested locally

- 769 backend tests passed after the final transfer transaction change, including 30 new assignment/database/API/parser-concurrency checks.
- 14 frontend utility tests passed.
- Production Vite build passed.
- Focused ESLint checks passed for the new application and test JavaScript plus the changed parsing/storage helpers.
- `git diff --check` passed.
- Isolated PostgreSQL executed the actual migration, constraints, timestamp triggers, RLS, service-role-only RPCs, rollback, duplicate linking, idempotent saves/transfers, scoped deletion, and document cleanup claims.
- Actual Express routes and the existing candidate controller were exercised against the isolated database through a test Supabase adapter. Storage was simulated.
- Browser verification uses the actual React application and local fixture API. Initial PDF identity extraction, manual correction for an unparsed file, wizard Back/Next, saving, filtering, sidebar counts, status grouping, stored-CV full parser fallback, complete existing candidate form, transfer, and deletion were exercised.

The full browser regression suite passed all 84 checks; the result is recorded in `browser-summary.json`. The suite contains 28 each in Chromium, Firefox and WebKit, including 15 Assigned Candidates checks. After the final exact-match Update Existing transaction fix, all 15 module browser checks passed again, including expanded coverage that proves reviewed fields are saved without adding another person or mandate association; this later result is recorded in `module-final-summary.json`. No application frontend code changed between those runs. Firefox uses a test-only distinct application identity to work around this macOS host's existing profile-directory launch failure. The original browser application.ini was preserved. Color checks wait for refreshed rows, and the column-style regression test moves the pointer away before comparing resting states.

Screenshots inspected: `admin.png`, `wizard.png`, `existing-form.png`. The wizard and table use existing FyndX controls/styles and Reports KPI cards. Laptop geometry and keyboard cancellation are also tested.

## Frontend safety follow-up

The final follow-up passed **21/21 module browser checks** (7 each in Chromium, Firefox and WebKit), with production Vite build, focused ESLint and `git diff --check` passing. See `ui-safety-summary.json` for the receipt and geometry measurements. This follow-up did not change backend or database behavior.

Corrected the wizard's inherited 70px left offset, a WebKit 6px page-width expansion when modal scrolling was locked, offscreen bottom-row action menus, and unstyled action buttons. Assignment popups now preserve scrollbar space; the row actions reuse the existing Candidates buttons. Assignment dropdowns fit the available modal space, retain keyboard focus, allow reopening the focused input, and consume Escape before the parent dialog. Shared dropdown/scroll helpers expose opt-in behavior for this module; their existing callers retain their defaults.

Measured popup open/close geometry at 768, 1024, 1280 and 1440px in every engine. All 12 samples preserve page horizontal position/width and center the wizard. The existing candidate and duplicate dialogs are checked for centering, and the reassignment menu is checked near the bottom of the viewport. Updated wizard and table screenshots were inspected against the existing navy/gold controls. These are local synthetic checks, not a deployment or real-user acceptance sign-off.

## Sidebar and cancellation follow-up

Sidebar/upload-cancellation follow-up: **30/30 module browser checks passed** (10 per engine), along with the production Vite build, focused ESLint and `git diff --check`. See `cancellation-summary.json`. New checks cover hidden sidebar scrollbars with working navigation, removing active and queued CVs during processing, saving only the retained files, and Cancel/Close while uploads are outstanding. Late results are retired after the parser/storage write settles, so removed CVs cannot return to the wizard or become assignments. A parser operation that has already started may finish in the background. A pagination assertion now waits for the actual second-page row count and checks its group, instead of assuming a particular synthetic candidate lies on that page when assignment timestamps tie.

An expanded mixed-batch cancellation check passed **6/6 focused browser checks** (2 per engine): while one upload is held in flight, two others finish and have `storage_ready=true`. The per-file cross removes one completed file; Cancel or the dialog cross removes the other before the held upload is released. That late upload is then discarded too. Each engine verifies six removed storage paths across both close methods, no remaining upload manifests for the cancelled files, no new assignments, and queued-file cancellation. See `processing-cancellation-summary.json`. Focused ESLint and `git diff --check` pass. This expands verification of existing behavior without changing application code or production data.

The live cleanup banner was initially investigated using read-only aggregate/schema queries: four staging uploads were eligible for cleanup, separate from two live assignments; the tables and service-role cleanup RPC permission were present. No production records, CV contents or storage objects were modified. That initial inspection established pending housekeeping work; the precise failure was later reproduced in the automatic-cleanup follow-up below. CV cleanup remains reference-aware and protects main Candidates documents.

## Table formatting follow-up

Table-formatting follow-up: **36/36 module browser checks passed** (12 each in Chromium, Firefox and WebKit), with production build, focused ESLint and `git diff --check` passing. See `pill-format-summary.json` and the inspected `pill-table.png`. The checks render main Candidates with synthetic data and compare its computed name/avatar, consultant-chip, status-pill, mobile and client-cell styles with Assigned Candidates; all three engines match. Candidate identity components and the canonical status badge map are shared. Assignment statuses remain separate, and white/yellow/grey row grouping is preserved.

Mouse and keyboard pill editing, Escape, all 13 assignment statuses, pending transfer guards, saved contact date preservation, sidebar refresh, menu viewport bounds and complete table headings are covered. The menu ignores a delayed scroll event when its anchor has not moved, fixing immediate closure after revealing a status cell. Fixed checkbox padding avoids clipping. Names retain their stored spelling and capitalization. The main CandidatesPage lint result remains 4 pre-existing errors and 2 warnings, identical to HEAD; no new finding was introduced. No backend/database change or new migration was required.

## CV column follow-up

**39/39 module browser checks passed** (13 each in Chromium, Firefox and WebKit), with production build, focused ESLint and `git diff --check` passing. See `cv-column-summary.json` and the inspected `cv-column.png`. A centered CV column immediately before Actions reuses main Candidates' `DocumentIconGroup`, filename tooltip, document icon, colors and loading spinner. The previous eye action is removed. Both administrator and consultant column layouts are checked, and the computed CV icon styles match main Candidates in every engine.

The browser check clicks an assigned consultant's CV icon, waits while the actual local Express authorization/signed-URL endpoint is held, verifies the loading spinner and duplicate-click guard, then confirms a new tab opens the signed URL for that assignment's upload. The signed URL serves a synthetic HTML preview because headless engines handle PDF viewers differently; this proves routing and opening behavior without claiming production storage or native PDF-viewer acceptance. The database is isolated and storage signing is simulated. Existing active-employment, page-permission and current-assignee checks remain in the unchanged endpoint. No backend/database change or migration was required for this CV-column follow-up.

## Automatic cleanup follow-up

Deletion already awaited cleanup, but the attachment-reference query was broken on the actual Data API: the SDK encoded the JavaScript array as PostgreSQL array syntax for a JSONB column. A read-only reproduction returned HTTP 400; the equivalent GET exposed SQLSTATE `22P02` (`invalid input syntax for type json`). The query now passes serialized JSON. The corrected read-only checks succeeded for all four eligible production manifests. No production data, storage objects, claims or migration history were changed.

**777/777 backend tests passed**, including seven new cleanup cases plus their parent test. The new coverage routes candidate-reference queries through the actual installed Supabase SDK and executes the serialized predicates in isolated PostgreSQL; this covers the wire-format failure missed by the previous direct database adapter. It verifies automatic removal of an unused deleted assignment's CV/manifest, preservation through `cv_storage_path`, `cv_link`, `resume_url`, `cv_attachments` and live assignment ownership, plus durable retry after storage failure. API checks assert zero pending cleanup and manifest removal after an ordinary deletion, and preservation after deleting a transferred assignment.

**12/12 focused browser checks passed** (4 each in Chromium, Firefox and WebKit). The delete flow now explicitly checks that the file was removed, its manifest is gone and no pending-cleanup banner appears. Transfer, individual upload removal and Cancel/Close cleanup regressions also pass. Focused ESLint and `git diff --check` pass. The application frontend did not change in this follow-up; the previously verified build is unchanged. See `automatic-cleanup-summary.json`. No new migration is needed. Production deletion uses the fix after the application revision is published and deployed.

## Existing repository findings

Repository-wide `npm run lint` remains failing: 885 errors and 3 warnings, dominated by generated `.vercel` files and existing source issues. Existing CandidatesPage findings were compared with HEAD; no new scoped lint failure was introduced. Focused checks pass.

Production dependency audits report:

- Frontend: 2 findings (1 high, 1 moderate), in the unchanged React Router dependency chain.
- Server: 6 findings (1 critical, 2 high, 3 moderate), in unchanged runtime dependencies including proxy-addr, axios, express/body-parser, qs and brace-expansion.

No broad dependency upgrade was performed. The only package addition is development-only, pinned `@electric-sql/pglite@0.5.10` for executing PostgreSQL tests with the existing Node test runner.

## Deployment status

The migration was not applied to production by this implementation session. A later read-only inspection on 19 October 2026 confirmed that the assignment tables and cleanup functions are now present in the production project, with service-role access to the cleanup RPC. No production records or storage objects were modified during the inspection. New environments still require `supabase/migrations/20261018204815_assigned_candidates.sql`; the sidebar/upload cancellation follow-up requires no additional migration. The follow-up source changes are included in the accompanying commit; Git history records publication. They require deployment to affect the live site. The JSON receipts retain the publication state at the time each verification ran.

## Requires manual verification

- Actual Supabase login sessions, RLS/Storage and signed document access after deployment.
- Real Gemini extraction and scanned-CV OCR quality/performance. Browser fixtures disable external AI credentials and exercise the existing parser's heuristic fallback.
- Real-world large CVs within the deployment's request-size and execution-time limits.
- The existing parser is PDF based: DOC/DOCX files remain assignable with manual details, and full parsing may also require manual entry. This limitation is inherited from the current parser; no unrelated parsing service was introduced.
- Multi-connection PostgreSQL load/concurrency testing and user acceptance with representative real workflows. PGlite serializes local requests; it is not a production load test.

The main Candidates status list remains unchanged. Both pending-contact statuses are assignment-only and are blocked from transfer at the API and transactional database layer. Main Dashboard/Reports queries were preserved; preliminary assignments cannot enter their main candidate sources.

Reporting constraint: the existing Dashboard/Reports count candidate–mandate associations. A duplicate linked to the same concrete association adds neither a person nor an association; linking an existing person to a new mandate adds one association and retains the existing pipeline counting behavior. Candidate master records remain distinct.
