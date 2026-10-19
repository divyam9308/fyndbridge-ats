# Assigned Candidates implementation and verification

This module stores preliminary CV assignments independently of Candidates. “Not Contacted” and “Didn’t Pick Up” exist only in Assigned Candidates. Both prevent transfer, enforced in the API and again inside the transfer transaction. The shared Candidates status lists are unchanged.

## Features implemented

- Sidebar navigation beside Candidates with a database aggregate badge for Not Contacted. Consultants see their own count; administrators see active consultants' combined count.
- Administrator Overall/consultant filtering with counts, active employee options, stable selection and four existing Reports KPI components.
- Requested table columns, current-page bulk selection, global database grouping and oldest-first ordering, editable statuses, system dates, protected CV access, and completed grey rows.
- One bulk upload wizard with three concurrent uploads, per-file recovery, manual correction, individual candidate steps, Back/Next, and an atomic, retry-safe batch Save.
- The actual `CandidatesPage` form in modal-only mode, all existing fields, existing validation and duplicate dialog, editable client/mandate defaults, stored-CV full parsing, and atomic candidate/association/link creation.
- Administrator reassignment, individual/bulk deletion and scoped Delete All. Delete All always preserves both pending contact statuses, including Added assignments that were later returned to those statuses.
- Frontend safety follow-up: centered 760px wizard, reserved scrollbar space while assigned popups are open, native Candidates row-action buttons, viewport-bounded action/filter menus, and form dropdowns that fit inside the popup and support keyboard navigation/Escape without closing the parent dialog.
- Sidebar scrollbars are hidden while wheel/keyboard scrolling remains available. During CV processing, individual Remove, Cancel and Close remain available. Removed queued files never start, removed active files cannot reappear or be saved, and late upload results are retired after the existing parser/storage request settles. Closing the wizard follows the same rule; successful batch saves retain their CVs.
- If some files have already uploaded while another is still processing, the individual cross deletes that uploaded file; Cancel or the dialog cross deletes all unsaved uploaded files. Any outstanding upload is discarded when its request finishes. Mixed-batch browser checks verify storage removal and manifest deletion for both completed and late uploads.
- Table presentation reuses the main Candidates name/avatar and consultant-chip components, mobile typography, status badge color map and popup menu styling. Clicking a status pill opens the assignment status menu, including both assignment-only pending states; keyboard editing and viewport boundaries are supported. Names retain their stored spelling/capitalization. The original assignment column order and white/yellow/grey row groups remain intact.
- A centered CV column before Actions uses the same `DocumentIconGroup` component, document icon, colors, filename tooltip and loading spinner as main Candidates. The former eye action is removed. Opening still uses the assignment-authorized signed-URL endpoint; repeated clicks while that request is pending do not issue duplicate requests.

## Database and deployment status

Migration: `supabase/migrations/20261018204815_assigned_candidates.sql`.

New tables:

- `assigned_candidates`: preliminary candidate identity, client/mandate, Auth consultant/admin references, current status, immutable assignment date, first contact date, persistent Added timestamp, main candidate/association links, and indexed generated sort group.
- `assigned_candidate_uploads`: owner-bound upload token, private document metadata, parse results containing only name/mobile, upload readiness, staging expiry, and a durable cleanup claim.

Existing table change: one nullable, indexed `candidate_associations.assigned_candidate_id` foreign key. Existing Candidates IDs, client IDs, mandate IDs, and historical migrations are preserved. Main candidate IDs use the existing database allocation trigger.

The migration was executed and tested in isolated PostgreSQL using PGlite. It was not applied to production by this implementation session. A later read-only inspection on 19 October 2026 confirmed that the assignment tables and cleanup functions are now present in production; no production data or files were changed during that inspection.

For environments without these tables, apply the migration to the intended Supabase project before deploying this application revision. Deploy the existing Express/Vercel entrypoint and frontend together. No new bucket or environment variable is required. Recheck Supabase advisors and exercise actual administrator/consultant accounts after deployment.

## APIs

All paths below are relative to `/api/assigned-candidates`, behind existing authentication, employee status and page-view middleware. Responses are private/no-store.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Scoped paginated rows, KPI aggregates and administrator consultant counts |
| GET | `/count` | Role-scoped Not Contacted badge aggregate |
| POST | `/uploads` | One existing-format CV, initial name/mobile parsing, durable upload token |
| POST | `/uploads/discard` | Retire owned staging uploads and retry bounded document cleanup |
| POST | `/` | Validated, atomic assignment batch; upload-token idempotency |
| PATCH | `/:id/status` | Authorized status change with database-managed contact date |
| PATCH | `/:id/consultant` | Administrator reassignment to an active employee |
| GET | `/:id/cv` | Record-authorized, short-lived signed document URL |
| POST | `/:id/parse` | Existing full parser applied to the stored CV |
| POST | `/:id/transfer` | Existing candidate validation/duplicate workflow plus atomic transfer |
| DELETE | `/:id` | Administrator individual assignment deletion |
| POST | `/delete` | Explicit IDs for bulk deletion, or server-calculated contacted-only deletion |

## Authorization and data integrity

Assignment SELECT RLS checks active employment and existing page permissions, then permits only the assigned Auth user or an administrator. Anonymous reads and direct authenticated writes are denied. Upload metadata is backend-only. Mutating and aggregate RPCs are service-role-only; transaction functions use invoker privileges and explicitly check the supplied actor where appropriate. Private, fixed-search-path helpers reuse `admin_users` and the existing active-employee helper. The restricted actor lookup avoids granting general Auth-table access to the service role.

Status mutations repeat the consultant ownership predicate on UPDATE, so a reassignment between read and write cannot grant access. Receiving consultants must be active. The database generates assignment/contact timestamps, preserves the first contacted timestamp, and rejects invalid status/reference data. Added state survives deletion of a linked main candidate, preventing accidental repeated transfer.

Transfer locks the assignment row. Candidate creation, mandate association and assignment linkage commit together. Lost-response retries return the committed result. Concurrent identity changes are rechecked within the transaction. Explicit Update Existing saves the reviewed candidate and association fields, appends the stored CV once, and links the assignment to the existing concrete candidate/mandate association without creating another person or association.

## Parsing and storage

Uses the existing private `resumes` bucket under owner/token/hash paths. No public CV URLs are generated. Initial parsing reuses text-first PDF extraction, OCR fallback and existing name/phone extractors, without calling full AI parsing or extracting other candidate fields. Full parsing explicitly uses the existing bulk parser and existing parser-output-to-form mapping. Assignment name, mobile, client, mandate, status and consultant context remain intact after parsing.

Uploads use the existing PDF/DOC/DOCX format rules and 10 MiB file cap. Files are sent individually, avoiding a combined multi-file request. The upload manifest is committed before object storage writes; failed writes are retryable. Three parsing tasks run concurrently per API instance, with a bounded waiting queue. Overload is recoverable.

The existing parser is PDF based. DOC/DOCX files can be stored and assigned, but their initial details require manual entry; the existing full parser may also reject those formats. No additional Word parser or parsing service was introduced. Real Gemini extraction quality and real scanned-CV OCR still require manual verification. Hosting may enforce a smaller request-body limit than the bucket's 10 MiB cap; HTTP 413 produces a recoverable message.

Cleanup checks both assignment ownership and main-candidate legacy/attachment references. Main Candidates document cleanup also preserves assignment-owned objects. Deletion retires upload metadata; cleanup claims prevent reuse while removal is in progress. Failed removals remain queued. Expired abandoned uploads are eligible after 24 hours. Cleanup runs in bounded batches after deletion/discard and on administrator page entry, with a Retry cleanup action when needed. Main-referenced documents are preserved and checked again after 24 hours. There is no new background scheduler; cleanup resumes on subsequent administrator activity.

Deleting an assignment automatically removes its unused CV and upload manifest in the same API request. A follow-up corrected the JSONB attachment-reference filter: passing a JavaScript array to the SDK encoded a PostgreSQL array and caused HTTP 400 / SQLSTATE `22P02`, leaving cleanup pending. The filter now sends serialized JSON. Regression coverage uses the real Supabase SDK filter serialization against isolated PostgreSQL, plus the actual delete routes, to verify unused-file removal and preservation through all three legacy CV fields, the attachment list, and live assignments. No additional migration is required.

## Existing components and integrations reused

`CandidatesPage` form and duplicate dialog; candidate controller normalization, validation, duplicate detection, permission checks and reference resolution; candidate ID trigger; `createBulkResumeParser`, existing OCR and extractors; `resumeController.rowFromParsed`; `ReportKpiCard`; `PaginationBar`; `FloatingDropdown`; shared table/modal/form styles; dialog focus/body-scroll helpers; `apiFetch`/protected URL opening; employee directory and admin/page permissions; realtime refresh and existing update events.

Dashboard and Reports queries remain unchanged. Untransferred assignments never enter `candidates` or `candidate_associations`. Transfers create real main records at the current server timestamp. Existing analytics grain and date semantics are preserved; linking an existing concrete association does not inflate totals. Existing Dashboard/Reports totals are association based, so adding a genuinely new mandate association for an existing person can increase a pipeline total without creating another person. Converting those existing metrics to distinct-person counts would change their current business definition and is not included.

## Files

New application files:

- `src/components/CandidateTableIdentity.jsx` (also used by main Candidates)

- `server/src/controllers/assignedCandidatesController.js`
- `server/src/routes/assignedCandidates.js`
- `server/src/services/assignedCandidates.js`
- `server/src/services/assignedCandidateCv.js`
- `server/src/services/assignedCvParsing.js`
- `src/pages/AssignedCandidatesPage.jsx` and `.css`
- `src/features/assigned-candidates/AssignmentWizard.jsx`, `AssignmentSelect.jsx`, `assignmentStatuses.js`
- `src/services/assignedCandidatesApi.js`
- The migration and this document.

New verification files:

- `server/src/services/assignedCandidates.test.js`, `assignedCandidatesApi.test.js`, `assignedCvParsing.test.js`
- `server/test-support/assignedCandidatesSchema.cjs`, `assignedCandidatesAdapter.cjs`, `assignedCandidatesServer.cjs`
- `server/browser-tests/assigned-candidates.spec.cjs`

Existing files modified:

- `server/src/app.js`, candidate and resume controllers, `adminAccess.js`, `bulkResumeParser.js`, `documentStorage.js`
- `src/App.jsx`, Sidebar, Topbar, CandidatesPage, page-view permission definitions, route preload map
- `FloatingDropdown.jsx` and `lockBodyScroll.js`: optional viewport fitting and scrollbar preservation, enabled by the assignment UI; existing callers keep their defaults.
- Server package manifest/lockfile: pinned PGlite 0.5.10 is a development-only PostgreSQL test engine; the existing Node test runner remains in use.
- `playwright.config.cjs`: optional Firefox executable override for the existing macOS profile-directory launch issue.
- `server/browser-tests/applied-columns.spec.cjs`: normalize pointer position before comparing resting styles, avoiding comparisons between hovered and unhovered controls.

## Verification boundaries

Synthetic fixtures are labelled Test/Example and never connect to production. Node API tests invoke the actual Express routes and candidate controller with a Supabase-compatible query adapter backed by isolated PostgreSQL. Browser tests run the real React application and those routes with synthetic Auth/session fixtures; uploads travel directly from the browser to the local fixture API. Storage is simulated in tests. These checks do not prove deployed Supabase Auth/Storage or real-user acceptance.

PGlite serializes execution through one local database instance. Retry/idempotency and transactional rollback are tested, but these are not multi-connection production concurrency/load measurements.

Run verification with:

```sh
npm --prefix server test
node --test src/utils/*.test.js src/features/attendance/*.test.js
npm run build
npm run lint
npm run test:browser
```

On macOS hosts where bundled Firefox cannot locate its profile directory, `FYNDBRIDGE_FIREFOX_EXECUTABLE` can point to a test-only launcher using a distinct application.ini identity. The application itself is unaffected.

Final test counts and repository-wide lint/dependency findings are recorded in `outputs/assigned-candidates-verification/verification.md`. The follow-up fixes and verification artifacts are included in the accompanying commit. Source publication is recorded in Git history; deployment is required before the fixes affect the live site.
