# Business development CRM

The CRM lives at `/dashboard/crm`. It creates independent business development
records and never creates, converts, or updates ATS Clients, mandates or candidates.

## Existing application analysis and reuse

The current source, rather than the older README descriptions, establishes the UI
and backend conventions:

- `ClientsPage.jsx` groups root and secondary client contacts into one table row.
  Its selected contact determines the name, mobile, email, designation and LinkedIn
  cells. CRM uses the same compact contact selector and add/remove row controls.
- Candidates, Clients and Mandates use `Shared.css`: navy `.fb-theme-table` headers,
  white header text, 11px uppercase headings, 13px cells, 12px/16px cell padding,
  subtle row borders/hover, horizontal overflow, rounded table containers and
  `PaginationBar`. CRM retains readable explicit column widths and uses these styles.
- Text, monospace mobile numbers, info-coloured email, compact LinkedIn links and
  shared candidate status badge classes follow the existing table conventions.
  Status/probability/source inline menus use `TablePopover`, the Clients save-on-
  selection pattern, disabled controls during requests and confirmed server values.
- Candidate/Client/Mandate modals use `.modal-overlay`, `.modal-card-lg`,
  `.modal-header`, `.modal-body`, `.modal-footer`, `.form-grid-2` and `.form-control`.
  CRM reuses them, `FormattedDateInput`, `useDialogFocus`, `lockBodyScroll` and the
  existing loader. The modal scrolls internally and traps/restores focus.
- Theme values come from `index.css`: navy `#001264`, gold `#DAB111`, warm page
  background, shared neutrals and success/error tokens. No parallel theme is added.
- Sector choices retain the exact original 18 options. `shared/sectorOptions.json`
  is their single source; the existing `sectorOptions.js` export is preserved.
- Consultants come from `useStaffDirectory`/`user_profiles` and existing employee
  status records. Active consultants are selectable; an existing inactive/deleted
  assignment remains readable and may be cleared or reassigned. No names are seeded
  or hardcoded into application code.
- `AuthContext`, existing authenticated `apiFetch`, `requireAuth`, the sidebar's
  permission-loading gate, `PageViewGuard`, Admin Page View Permissions and backend
  `requirePageViewPermission` supply authentication and page access. CRM visibility
  also fails closed if loading page permissions fails.

## Duplicate behaviour

The existing Clients controller compares organisation names after collapsing
whitespace, trimming, removing zero-width characters and lowercasing. It does not
fuzzy-match similar names or offer a save-anyway action. Exact duplicates yield 409
and an existing-client selection/update flow. That normalizer is extracted without
behaviour changes into `shared/clientNames.cjs`. CRM's SQL comparison has executable
normalization-equivalence tests.

CRM duplicates offer View More, Cancel and Update Client. Update Client opens the
existing CRM record, retaining existing contacts and appending genuinely new ones;
identical contacts are not duplicated. Duplicate contact email/mobile rules follow
Clients. An ATS-name match offers explicit selection of the existing ATS identity
before saving its separate CRM record; there is no mutation to ATS data. This is the
necessary adaptation of existing-client selection to the required CRM/ATS boundary.
Editing a record excludes itself and rechecks a changed organisation name.

## Database and API

CRM contact rules now require only Organisation Name and Contact Person. Mobile,
email and other contact details are optional; a supplied email/LinkedIn URL is
still validated, and duplicate checks ignore blank phone/email values. Apply
`20261020042221_crm_optional_contact_details.sql` before deploying these form changes.
The CRM toolbar uses one desktop row in this order: New, search, Read all,
Follow-ups, sort, Gmail disconnect, sync, connection details. Narrow screens wrap
the controls. The top bar supplies the page heading. Long contact names wrap within
their table cell and contact controls remain inside that column.

Migration `supabase/migrations/20261019105523_business_development_crm.sql` was applied
to the configured ATS FYNDBRIDGE Supabase project (`owheruvatjcfqwsejnmo`) on
19 October 2026. The local filename matches hosted migration version `20261019105523`.
Hosted schema, access grants, RPC execution and rollback smoke tests passed.
Application code remains local and uncommitted; no application deployment was made.

- `crm_clients`: stable UUID, ordered JSONB contact group, nullable optional fields,
  consultant/ATS references, version and authoritative database creation/update dates.
  JSONB keeps a contact group atomic without a fourth table or extra organisation rows.
- `crm_comments`: immutable application-level append-only comment history.
- `crm_activities`: old/new structured values and authenticated actor. Comment events
  reference comments; comment text is not copied into the activity table.
- `crm_save`: one transaction for the entire operation, row/version checks, exact
  name uniqueness, contact validation, assignment checks, comment and activity writes.
  Failed saves roll back; stale saves return 409 while preserving the user's draft.
- `crm_list`: server pagination, search, stable organisation/date ordering, follow-up
  filters and indexed latest-comment lookups. Full histories load only on request,
  25 entries per page. Assignment remains a modal field, never a table filter.
- Database table RLS is enabled with all browser-role access revoked. Tables/RPCs are
  service-role only, following the existing backend-only mutation architecture.
  Every `/api/crm` endpoint checks authentication, employment status and current CRM
  page permission. Payload usernames, timestamps and audit IDs are ignored.
- Company-local follow-up date comes from the existing server `localDate` utility;
  overdue/today/upcoming/none indicators use existing red/gold/navy/neutral tokens.
- Inline updates reconcile individual rows immediately and refresh the current
  server-filtered page without navigating or resetting search, pagination, contact
  selection or comment drafts. Concurrent changes are rejected rather than lost.

Organisation deletion is available in each row's Actions using existing CRM page
access. A confirmation names the organisation and explains permanent removal of its
CRM contacts, comments, activities and read receipts. A version-checked DELETE
prevents removal after an unseen concurrent edit; failure keeps the row and dialog
available. Existing foreign-key cascades perform cleanup atomically, preserving
linked ATS clients, mandates, candidates, unrelated CRM records and Gmail connections.
Deletion requires no additional migration beyond the migrations documented above.

No imports/exports, automation, conversion, notifications, dashboards or consultant
filters are introduced.

## Verification

### Per-user unread activity

`20261019185136_crm_activity_read_receipts.sql` adds server-only read receipts and
two SECURITY INVOKER RPCs. Apply it after the CRM/Gmail migrations and before
deploying the updated API/UI. This change has not applied the migration to hosted
Supabase or deployed the application.

- Unread changes tint a client row green (`#e2f3e7`). The latest unread email's
  sentiment takes precedence: positive green, neutral/unknown gray (`#f1f3f5`),
  negative red (`#fcebea`), matching Assigned Candidates. Newly viewed activity
  cards retain the same tints for the current history view.
- Receipts are per authenticated viewer and activity ID, persist across reloads,
  and never alter CRM fields or another viewer's state. Existing activities start
  unread because previous viewing history was not recorded.
- Opening Activity History acknowledges only the displayed page's activity IDs
  after rendering. Comment History does not acknowledge activities. Concurrently
  arriving emails and unviewed history pages stay unread; failed acknowledgements
  keep the highlight and offer a retry.
- **Read all**, between search and Follow-ups, acknowledges all current CRM
  activities for the viewer across every page/filter. It does not affect Gmail's
  own inbox read status. Newly arriving activity remains unread.
- Current-page unread state refreshes after manual Gmail sync, activity reads,
  returning to the tab and the existing minute refresh.
- Manual sync never opens the connection dialog automatically. Finished runs,
  including partial runs with failed email jobs, show a green tick and **Synced**
  for five seconds. Queued, quota-paused and failed requests use brief button
  labels without claiming completion. The info icon opens the retained details.

`server/src/services/crmActivityReads.test.js` exercises real PostgreSQL receipts,
idempotency, concurrent arrivals, sentiment choice and browser-role denial.
`server/browser-tests/crmGmail.spec.cjs` verifies the API-backed row/card colours,
read persistence, viewer isolation, global Read all, retries and mobile layout.

`server/src/services/crm.test.js` executes the actual migration in PGlite PostgreSQL,
with synthetic auth/employee fixtures and service/browser database roles. It covers
mandatory-only and multi-contact creation, nullable optional fields, assignment,
normalization/duplicates across both modules, exact-name self-edit exclusion,
transaction rollback, append-only comments, actor/timestamp authority, actual-change
activities, stale versions, inactive assignments, paginated queries and role denial.

`server/browser-tests/crm.spec.cjs` runs the real CRM React page and Express router
against that isolated database. Existing test authentication is synthetic; no hosted
credentials or production records are used. Screenshots in
`outputs/crm-verification/` are synthetic verification evidence, not demo data shipped
with the CRM. Coverage includes complete create/edit/inline flows, refresh persistence,
all follow-up states, duplicate resolution, permissions, failed writes, stale edits,
mandatory indicators, consultant defaults/reassignment, pagination/search/sorting,
URL validation, history and narrow-screen horizontal scrolling.

There is no TypeScript/typecheck script in this JavaScript repository. Build, lint,
backend and browser test results are recorded in `outputs/crm-verification/results.md`.

## Source file inventory

Created:

- `src/pages/CrmPage.jsx`, `src/pages/CrmPage.css`
- `src/components/CrmDialogs.jsx`
- `src/services/crmApi.js`, `src/utils/crm.js`
- `server/src/routes/crm.js`
- `shared/clientNames.cjs`, `shared/sectorOptions.json`
- `supabase/migrations/20261019105523_business_development_crm.sql`
- `server/src/services/crm.test.js`, `server/test-support/crmServer.cjs`,
  `server/browser-tests/crm.spec.cjs`
- This document and `outputs/crm-verification/` verification artifacts.

Modified:

- `src/App.jsx`, `src/utils/routePreload.js`: lazy CRM route/preloading.
- `src/components/Sidebar.jsx`, `src/components/Topbar.jsx`: native CRM navigation/title.
- `src/utils/pageViewPermissions.js`, `src/hooks/usePageViewPermissions.js`,
  `server/src/services/adminAccess.js`: existing permission registry and fail-closed CRM visibility.
- `server/src/app.js`: authenticated CRM router.
- `src/utils/sectorOptions.js`: preserved export backed by the shared options source.
- `server/src/controllers/clientController.js`: exact existing normalizer extraction only.

## CRM display refinements — 19 October 2026

- Comments share the unchanged Candidates/Clients `previewWords` helper in
  `src/utils/tableText.js`: date plus the first three comment words, then the native
  View more / View less control. Clicking the comment still opens its inline editor.
- CRM uses the date picker's opt-in `floating` mode, positioning its full calendar
  within the viewport rather than clipping it inside the modal's scrolling body.
  The calendar remains in the modal DOM for focus management. Existing date fields
  elsewhere retain their previous default positioning.
- Status, probability and source buttons open on click without decorative arrows.
- Conversion bands use restrained red, orange, amber and green pills; 75–100% is green.
- The probability sort is applied before database pagination, with unset values last.
  Migration `20261019110948_crm_probability_sorting.sql` is applied in hosted
  ATS FYNDBRIDGE and verified with a rolled-back six-record sorting test.
