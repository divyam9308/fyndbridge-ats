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

## Existing repository findings

Repository-wide `npm run lint` remains failing: 885 errors and 3 warnings, dominated by generated `.vercel` files and existing source issues. Existing CandidatesPage findings were compared with HEAD; no new scoped lint failure was introduced. Focused checks pass.

Production dependency audits report:

- Frontend: 2 findings (1 high, 1 moderate), in the unchanged React Router dependency chain.
- Server: 6 findings (1 critical, 2 high, 3 moderate), in unchanged runtime dependencies including proxy-addr, axios, express/body-parser, qs and brace-expansion.

No broad dependency upgrade was performed. The only package addition is development-only, pinned `@electric-sql/pglite@0.5.10` for executing PostgreSQL tests with the existing Node test runner.

## Requires deployment

The new Supabase migration is **not applied to production**. Live inspection was read-only and confirmed the existing private `resumes` bucket. Apply `supabase/migrations/20261018204815_assigned_candidates.sql` to the intended project, then deploy the frontend and backend revision together and run advisors. No new storage bucket or production secret is needed. Application deployment was not performed during local verification; source publication is recorded in Git history.

## Requires manual verification

- Actual Supabase login sessions, RLS/Storage and signed document access after deployment.
- Real Gemini extraction and scanned-CV OCR quality/performance. Browser fixtures disable external AI credentials and exercise the existing parser's heuristic fallback.
- Real-world large CVs within the deployment's request-size and execution-time limits.
- The existing parser is PDF based: DOC/DOCX files remain assignable with manual details, and full parsing may also require manual entry. This limitation is inherited from the current parser; no unrelated parsing service was introduced.
- Multi-connection PostgreSQL load/concurrency testing and user acceptance with representative real workflows. PGlite serializes local requests; it is not a production load test.

The main Candidates status list remains unchanged. Both pending-contact statuses are assignment-only and are blocked from transfer at the API and transactional database layer. Main Dashboard/Reports queries were preserved; preliminary assignments cannot enter their main candidate sources.

Reporting constraint: the existing Dashboard/Reports count candidate–mandate associations. A duplicate linked to the same concrete association adds neither a person nor an association; linking an existing person to a new mandate adds one association and retains the existing pipeline counting behavior. Candidate master records remain distinct.
