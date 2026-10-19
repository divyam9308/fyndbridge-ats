# CRM implementation verification — 19 October 2026

Implementation is local and uncommitted in the nested `fyndbridge-ats` repository.
The hosted Supabase migration was subsequently applied and verified on 19 October
2026 in ATS FYNDBRIDGE (`owheruvatjcfqwsejnmo`), version `20261019105523`.
No application deployment was made.

## Results

| Check | Result |
|---|---|
| Normal production build (`npm run build`) | Passed |
| Full backend suite (`cd server && npm test`) | 788 passed, 0 failed |
| Actual PostgreSQL CRM migration/security tests | 10 passed, 0 failed (included in backend count) |
| Broad Chromium/WebKit browser regression run | 98 passed, 0 failed |
| Final production-build Chromium/WebKit CRM and existing-form checks | 12 passed, 0 failed |
| ESLint on new files and other modified JS/JSX | Passed |
| Existing modified Clients controller | Same 5 unused-symbol findings as pre-change HEAD |
| Repository-wide lint | 888 existing findings (885 errors, 3 warnings) |
| Whitespace/conflict check (`git diff --check`) | Passed |
| Type checking | No typecheck script; project is JavaScript |

Browser checks run React and the real Express CRM routes against an isolated
PostgreSQL/PGlite database executing the actual migration. Authentication and
employee fixtures are synthetic. No production data or credentials are used.
All persisted history checks are database-backed, including browser refresh.

## Verified boundaries

| Boundary | Evidence |
|---|---|
| UI entry and permissions | CRM sidebar/route access, top-left Add Client, four mandatory field types |
| Form to API | Real POST/PATCH requests, mandatory-only and multiple-contact records |
| API to database | Actual `crm_save` transaction, constraints, role restrictions, version rejection |
| Database to response | Returned contacts, authoritative timestamps, latest comment and audit actor |
| Response to UI | Correct selected-contact cells, inline updates, dated comments, durable histories |
| Failure handling | Failed write leaves displayed value unchanged; stale form preserves draft and offers reload |
| Query controls | 26 records paginated across pages, page-size change, sorting and contact-email search |
| Existing UI | Candidates, Clients and Mandates tables and native add forms rendered in both browsers |
| Small viewport | 390px page has no document overflow; wide table scrolls inside its container |

The broader browser suite also exercises Assigned Candidates, candidate transfer,
Applied Candidates, PMS, employee deactivation and Admin permissions. Existing client,
mandate and duplicate-related backend tests remain in the passing full backend suite.

## Issues found and fixed

- Shared sector options initially used a CommonJS client import that worked in the
  build but failed under Vite development. The single source is now JSON, supported
  by both runtimes.
- A wide table initially enlarged the flex content area. Scoped flex constraints
  now keep scrolling inside the CRM table, with compact sidebar navigation on phones.
- The initial search debounce could race a quick page change. It now schedules only
  when search text actually differs from the committed query.
- The duplicate dialog now restores the form on Escape, retaining the draft and
  reinitializing the existing focus-management hook on dialog transitions.

## Limitations

The hosted CRM schema and database access controls have been verified. Application
code remains local; deployed frontend/backend acceptance is not claimed.

Global lint includes pre-existing source and `.vercel/output` findings. The five
findings in `clientController.js` were independently reproduced from `HEAD` via
ESLint stdin; no new errors were introduced there. Unrelated lint fixes are excluded.

All screenshots are synthetic test evidence. The separate requested CRM reference
image was not supplied; current ATS source and rendered native forms guided styling.

## Evidence

- `crm-page.png`: initial columns and native table/page styling.
- `right-columns.png`: horizontal scroll reaches comments, probability, status and actions.
- `add-client.png`: native CRM contact/assignment form.
- `activity-history.png`: durable activities, comment references and actor display.
- `mobile.png`: responsive table and deliberately exercised network-error state.
- `existing-clients-modal.png`, `existing-candidates-modal.png`,
  `existing-jobs-modal.png`: native ATS form comparisons.

## Hosted Supabase follow-up verification

- Confirmed both frontend and backend configuration target ATS FYNDBRIDGE.
- Applied only `business_development_crm`, hosted version `20261019105523`.
- Confirmed `crm_clients`, `crm_comments` and `crm_activities` exist with RLS enabled.
- Confirmed anon/authenticated table access and RPC execution are revoked, while
  service-role access is granted. All four functions remain SECURITY INVOKER.
- Confirmed the existing page permission registry contains `crm: everyone`.
- Exercised actual hosted create/update RPCs as service_role in a rolled-back
  transaction: assignment default, audit actor, creation-date preservation, two
  comment entries, exact duplicate rejection, stale-version rejection and no-op
  activity suppression all passed. After rollback all three CRM tables had zero rows.
- Security advisors report informational RLS-without-policy notices for these
  backend-only tables. Their browser grants are revoked; this is the intended
  architecture, with permission enforcement in Express.
  [Supabase notice explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Existing unrelated search-path/password-protection notices were left unchanged.
  [Search path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
  [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
