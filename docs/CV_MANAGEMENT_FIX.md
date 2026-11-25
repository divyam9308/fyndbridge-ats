# CV management implementation and verification

Verification date: 26 November 2026 IST. The user subsequently authorized commit,
push to main and Supabase application. The forward migration has now been applied
to ATS FYNDBRIDGE. No duplicate cleanup, historical branding or backfill was run.
The implementation is being committed and pushed to the Git-linked main branch.

## Confirmed causes

- The effective hosted transfer RPC appended attachments by storage path. Equal
  source content at another path remained a separate attachment; legacy primary
  fields were omitted when secondary attachments existed.
- Legacy Assigned transfers copied the upload reference directly into Candidates.
  They never called the new-upload branding queue.
- PDF generation always stamped and did not inspect existing fb1 artwork. Ready
  status/path checks could reuse an object without verifying its stored output.
- Commit `d0ade3b` replaced a 15 px document icon with a 22 px branding wrapper
  without changing its button padding. The wrapper caused the enlarged square.
- Cleanup had raw-path-only checks, row-limited candidate scans and a check/delete
  race. Cancellation could remove referenced output. A failed multi-file removal
  could restore references to objects already removed earlier in the batch.
- Exhausted interrupted worker claims could remain in `processing` indefinitely.

Read-only hosted inspection confirmed the current transfer/cleanup/worker function
definitions. The snapshot contained 3,895 candidates with CV references, 909 assigned
uploads, 47 ready branding jobs, one cancelled job and 297 untransferred legacy
assignments. These are dated counts, not evidence that every ready PDF is visually
correct. No real candidate PDF was downloaded for this task.

## Implemented behavior

### Identity and new uploads

The canonical identity is the original source SHA-256. Verified source/result job
mapping connects an ATS-branded derivative to that source. `input_sha256` separately
verifies the bytes actually staged when an already branded derivative is uploaded.
Filenames and path suffixes never establish content identity.

Main creation/editing, parsed/bulk inputs, additional/replacement uploads, Assigned
uploads including Overall, and public-application adoption use the existing staging
and branding infrastructure. Reuse goes through actual stored-output verification.
Candidate attachment merging checks old stored bytes against newly staged sources,
keeps genuine versions and prefers branded output or its pending reservation over
an identical historical original. Pending reuploads also verify the private staged
input, so identical uploads made before the worker finishes do not add two CVs.

Generic document normalization still deduplicates by path only; unrelated document
types do not inherit CV-specific content rules. Existing external links are kept as
links. There is no new external document retrieval or arbitrary URL fetch.

### Legacy transfers and concurrency

Only a consultant-initiated transfer creates a durable request keyed by assignment.
It stores the reviewed candidate/association payload and actor, so repeated clicks
reuse it and a browser refresh does not lose the request. No main record is created
until its required CV is ready and verified. New and bulk transfers use this same
path; no-CV transfer remains supported.

Existing branding-job metadata distinguishes managed uploads from older raw
Assigned objects. There is no arbitrary date cutoff. The worker reuses an equivalent
verified result when available; otherwise it stages only that assigned source into
the existing queue. The original assigned upload stays recoverable and unchanged.
A damaged transfer result can be repaired from a distinct retained source, after
the existing stage identity check, without branding any other historical document.

The worker rechecks actor/page/column/record access. The database repeats current
employment, ownership/Overall, status, identity and mandate checks. Assignment,
upload and destination locks serialize transfer commits. The merge covers all
legacy primary aliases and all secondary attachments. Source evidence is verified
in batches of five and persisted between steps; no later attachment is silently
skipped. A CV snapshot comparison under the destination lock detects concurrent
changes and causes a fresh verification pass. Snapshot equality is insensitive to
PostgreSQL JSONB object-key ordering. Ordinary candidate CV writes also use an
atomic seven-field snapshot predicate; concurrent attachment edits return a
recoverable 409 instead of overwriting an acknowledged CV version.

POST transfer returns HTTP 202 while processing. Authorized GET reports pending,
failed or complete. The form polls every three seconds for at most 60 seconds;
the visible list refreshes every five seconds only while a transfer is pending.
The worker continues through existing cron/Node recovery. Success/Added is shown
only after the transaction commits. Failures retain the payload/source and offer
Retry and Review transfer; Review can resolve a newly discovered duplicate conflict.
Completed bulk members remain completed when another member fails.

### PDF verification and idempotency

Inspection compares the actual embedded artwork/resources and the final approved
draw operation on every page, including placement, 60% opacity and Multiply. A
forged metadata marker, branded-looking filename or ready job alone is insufficient.
Correct existing output is returned byte-for-byte unchanged. Partially branded
documents receive a stamp only on pages that lack it. Stored bytes are downloaded,
hashed and structurally checked before readiness/reuse/access.

Corrupt ready objects block opening and become a visible reupload-required failure
when their private original no longer exists. An explicit same-source reupload can
repair the reservation. Interrupted third worker claims become failed and can be
retried, rather than staying in processing forever.

The existing logo PDF and shared fb1 design configuration are unchanged: 45 mm
subject to the existing small-page rule, 7.5 pt inset, 0.6 opacity, upper-left on
every page, Multiply, original page boxes/rotation/content preserved.

**Artwork discrepancy:** the existing repository asset actually includes the name
and tagline. The request simultaneously specified icon only and no alteration of
the existing artwork. The supplied asset has been preserved; icon-only output is
not claimed. The user preference question remains unresolved. Arbitrarily flattened,
recompressed or manually added logos cannot always be recognized reliably; uncertain
source mappings remain separate rather than risking deletion of a genuine version.

### Storage and existing duplicate cleanup

A service-only deletion claim checks normalized references across all main primary
fields, JSON attachments, assigned upload manifests and pending/failed transfers.
It takes the same per-path lock as reference writers and leaves a permanent
tombstone; subsequent writers cannot attach a deleted object. Cancellation is
performed only after the claim succeeds. Storage removal failures retain durable
claims; the existing worker reaps bounded pending claims. Assignment manifests keep
their existing recoverable cleanup lifecycle. No original is removed before safe
replacement/reference completion. Duplicate consolidation removes references only.

The cleanup command accepts 1–25 explicit candidate IDs and at most 50 references
per candidate. Default operation is a dry-run. Missing-hash downloads require the
explicit `--hash-missing` option and stay within those selected records. Ambiguous,
missing, corrupt and unsupported objects are preserved. Plans report retained and
removed references, verified branded keepers, shared references, potential later
orphans and ambiguity. Apply re-verifies the plan and uses a locked snapshot CAS;
it never brands a document or physically deletes a storage object. Repeated references
to the same path are also consolidated while the retained object remains protected.

```sh
# Run from the repository root; plan output is private and must be reviewed.
node server/scripts/cv-duplicate-cleanup.js \
  --candidate-id <CANDIDATE_UUID> --hash-missing --out /private/path/cv-plan.json

# Separately authorized, reviewed reference consolidation only:
node server/scripts/cv-duplicate-cleanup.js --apply --plan /private/path/cv-plan.json
```

The command uses the existing backend Supabase credentials. No cleanup command was
run against production. Do not publish live plan files or candidate documents.

## Execution and independent review

| Workstream | Actual model/reasoning | Responsibility |
| --- | --- | --- |
| Root session | Existing session; no in-place model switch | Architecture, contracts, controllers, orchestration, upload merging, cleanup tooling, integration and final checks |
| `branding` | Native `gpt-6.1-sol`, High | PDF inspection/idempotency, queue verification/repair, PDF tests and eight-page visual QA |
| `transfer_database` | Native `gpt-6.1-sol`, High | Forward migration, identity helper, database tests and fixtures |
| `frontend` | Native `gpt-6.1-sol`, Medium | Historical compact icon, durable single/bulk UI, API/browser integration tests |
| `independent_review` | Native `gpt-6.1-sol`, High | Read-only integrated review and independent regression runs |

At most three subagents ran concurrently. Branding, database and frontend work ran
in parallel with explicit file ownership; the reviewer then used the freed slot.
The root reviewed all agent diffs, integrated shared contracts and fixed findings.
No claim is made that the root session was switched to Sol XHigh.

Review found and resolved unverified generic hash deduplication, primary/secondary
preview authorization, exhausted claims, retry-only conflict recovery, pending
upload duplication, separate-source output repair and JSONB snapshot batch resets.
The reviewer independently passed the final seven transfer/cleanup tests and found
no unresolved blocker within the local synthetic scope. Earlier independent route,
cleanup and database review also passed 20 tests.

## Validation results

| Check | Result |
| --- | --- |
| Full backend `cd server && npm test` | 951 passed; zero failed/skipped |
| Frontend `node --test src/**/*.test.js` | 28 passed; zero failed/skipped |
| Existing Assigned Candidates browser suite, Chromium | 26 passed |
| Focused CV browser suite, Chromium + WebKit | 8 passed after review fixes |
| Firefox focused cases | Four could not start: installed browsers report `Could not find profile folder`; alternate installed build and `/private/tmp` also failed |
| Production build `npm run build` | Passed |
| Type check | Not applicable: JavaScript project with no configured type-check script |
| Changed-file ESLint compared with HEAD | Zero new findings; 12 existing findings retained |
| Global `npm run lint` | Fails on existing findings; final full run reported 886 errors and three warnings, including generated `.vercel` output |
| `git diff --check` | Passed |
| Security checks | Service-only RPC/table grants, RLS, denied anon/authenticated calls, normalized references, concurrent merge/claim behavior and no external fetch covered locally |
| Dependency audits, existing manifests/lockfiles | Root: one high, one moderate; server: one critical, four high, one moderate. Existing packages/locks are unchanged; no audit fix/install was run |

Existing audited packages include root React Router and server axios/body-parser,
brace-expansion/follow-redirects/proxy-addr/qs. These baseline advisories remain a
separate deployment-security consideration; this CV change does not resolve them.

The synthetic eight-page PDF was rendered with Poppler and every page visually
inspected: four rotations, offset crop/media boxes, opaque scanned raster,
transparency, multiple sizes and a tiny page. Structural tests confirm geometry,
original content streams, configured opacity and byte-identical repeat branding.
The root also inspected the scanned output and final mobile icon capture.

Artifacts:

- `output/pdf/cv-management-verification/synthetic-source.pdf`
- `output/pdf/cv-management-verification/synthetic-branded.pdf`
- `output/pdf/cv-management-verification/verification.json`
- `output/pdf/cv-management-verification/branded-page-1.png` through `branded-page-8.png`
- `output/cv-management-verification/compact-cv-desktop.png`
- `output/cv-management-verification/compact-cv-mobile.png`
- `output/cv-management-verification/cv-container-before.png` (historical CSS dimensions reconstructed in the browser, not a production screenshot)

These contain synthetic data only. Older tracked screenshots, CLI cache changes
and generated version metadata from testing were restored to their initial content.

## Deployment and limits

1. Pause new transfers/uploads and drain old in-flight workers during the
   coordinated rollout. The old transfer backend cannot satisfy the new gate.
2. Apply `supabase/migrations/20261125210111_cv_transfer_identity_and_storage_integrity.sql`
   after the existing branding/Overall migrations, using normal controlled deployment.
   It is additive/forward-only, without historical CV data updates. It adds service
   tables, checks/guards/indexes and replaces the transfer/claim RPCs while retaining
   their signatures and service-role restrictions.
3. Deploy backend and frontend together; resume work with the existing cron/Node
   recovery schedule. No new cron, service, dependency or environment variable is
   required. Preserve `CRON_SECRET` and existing private Storage configuration.
4. Exercise real authorized upload, transfer, preview/download, retry and deletion
   with controlled synthetic records on the hosted environment; inspect generated
   PDFs and run hosted database advisors after applying the new schema.
5. Review specific cleanup dry-run plans. Any production reference consolidation
   requires separate authorization. There is no automatic historical backfill.

Word conversion was tested with injected deterministic conversion and failure
handling. This local environment has no `CV_WORD_CONVERTER_URL`, so actual private
Gotenberg layout conversion was not exercised. Existing `CV_WORD_CONVERTER_URL`
and optional `CV_WORD_CONVERTER_TOKEN` are still required where Word uploads are
supported; without configuration they are explicitly rejected, never served as
ready unbranded CVs. The hosted migration was applied and schema/permission/trigger checks passed.
Hosted security advisors were inspected; existing search-path and leaked-password
protection warnings are outside this CV change. End-to-end production Storage
operations and real Word conversion are not claimed as verified. Database tests use
isolated PGlite, not a production transaction or a multi-process hosted load test.

Database function privilege guidance follows the official
[Supabase database functions documentation](https://supabase.com/docs/guides/database/functions).

## Acceptance summary

| Requirement | Verified result |
| --- | --- |
| New ordinary CV uploads receive automatic backend branding | Passed locally through real routes/worker; Word service integration requires configured converter |
| Eligible legacy Assigned CVs branded only on transfer | Passed, durable worker and gated RPC |
| Unrelated historical Main CVs untouched | Passed; open/preview tests create no branding job |
| Identical primary/secondary and original/derivative CVs deduplicate | Passed, including pending uploads, repeat/concurrent transfer and complete batched lists |
| Genuine versions preserved | Passed; same names and stale declared hashes do not discard different bytes |
| ATS output not double stamped | Passed; exact verified fb1 output remains byte-identical |
| Assigned deletion preserves referenced Main CV | Passed through real API and normalized reference-claim tests |
| Compact icon restored | Passed; historical 15 px wrapper and 31 × 21 px shared control; keyboard, retry, spinner and mobile checks |
| Approved existing design unchanged | Asset/config unchanged; icon-only wording conflicts with actual asset as documented |
| Unrelated ATS functionality preserved | No unrelated business modules edited; full backend/frontend suites pass; no production claim |

The implementation is prepared for controlled rollout, with the artwork decision,
baseline dependency advisories and hosted/Word/Firefox checks explicitly outstanding.

## File manifest

The following manifest lists every changed source, test and documentation file.
Generated proof artifacts are listed above.

| File | Purpose |
| --- | --- |
| `README.md` | CV rollout and implementation-report entry point. |
| `docs/CV_MANAGEMENT_FIX.md` | Complete implementation, verification, deployment and cleanup report. |
| `server/browser-tests/assigned-candidates.spec.cjs` | Existing browser workflows adapted to durable transfers and source deduplication. |
| `server/browser-tests/cv-branding.spec.cjs` | Compact icon, keyboard/retry, durable transfer, responsive and screenshot regression checks. |
| `server/scripts/cv-duplicate-cleanup.js` | Bounded explicit-ID dry-run and separately reviewed plan apply CLI. |
| `server/src/controllers/assignedCandidatesController.js` | Canonical upload hashes; authorized durable transfer status/retry and list state. |
| `server/src/controllers/candidateController.js` | Queue transfer requests, verified upload merge, atomic CV snapshot writes and safe cleanup. |
| `server/src/routes/assignedCandidates.js` | Protected transfer status and retry endpoints. |
| `server/src/services/assignedCandidateCv.js` | Assignment cleanup uses atomic reference-aware storage claims. |
| `server/src/services/assignedCandidateOwnerWorkflow.test.js` | Preserve Overall permission assertions with CV snapshot conflict semantics. |
| `server/src/services/assignedCandidates.test.js` | Exercise direct transfers with explicit verified request metadata. |
| `server/src/services/assignedCandidatesApi.test.js` | Real API, durable worker, generated PDF, dedup and cleanup integration. |
| `server/src/services/assignedCvTransfer.js` | Durable transfer preparation, worker replay, identity batches and targeted result repair. |
| `server/src/services/assignedCvTransfer.test.js` | Restart/retry, secondary dedup, source repair, large lists and deletion protection. |
| `server/src/services/consultantAccess.test.js` | Verify Overall permission through asynchronous actual transfer. |
| `server/src/services/cvBranding.js` | Verified source/result reuse, staged-input hash, repairs, worker integration and protected cancellation. |
| `server/src/services/cvBranding.test.js` | Branding/idempotency, queue recovery, output corruption and cancellation regressions. |
| `server/src/services/cvBrandingPdf.js` | Actual approved artwork/draw validation, partial-page completion and byte-preserving idempotency. |
| `server/src/services/cvBrandingRoutes.test.js` | Real upload/open/delete, primary+secondary authorization and concurrent multipart save tests. |
| `server/src/services/cvDocumentIdentity.js` | Complete document enumeration, actual stored identity verification and resumable evidence. |
| `server/src/services/cvDuplicateCleanup.js` | Verified reference-only duplicate plan and revalidated CAS application. |
| `server/src/services/cvDuplicateCleanup.test.js` | Cleanup preservation, pending upload dedup, worker leases and storage retry. |
| `server/src/services/cvStorage.js` | Remove primary/path-only reuse shortcut; preserve staged canonical source hash. |
| `server/src/services/cvStorageIntegrity.js` | Atomic deletion claim wrapper and bounded pending-removal recovery. |
| `server/src/services/cvTransferIntegrity.test.js` | Database dedup, permissions, snapshots, no-CV compatibility and tombstone integrity. |
| `server/src/services/cvUploadedAttachments.js` | Candidate-only staged-source dedup with verified legacy/pending predecessor content. |
| `server/src/services/documentAccess.js` | Authorize all candidate legacy primary and secondary CV references. |
| `server/src/services/documentAttachments.js` | Prefer canonical source_sha256 when normalizing CV metadata. |
| `server/src/services/documentStorage.js` | Route resumes deletion through protected claims without row-limited reference scans. |
| `server/test-support/assignedCandidatesAdapter.cjs` | Synthetic actor lookup and correct nullable inserts for real worker tests. |
| `server/test-support/assignedCandidatesSchema.cjs` | Install the forward migration in isolated database fixtures. |
| `src/components/CvBranding.css` | Restore historical 15 px footprint with unchanged absolute processing/retry indicators. |
| `src/features/assigned-candidates/AssignmentTransferWizard.jsx` | Await durable completion and preserve bulk partial-failure behavior. |
| `src/pages/AssignedCandidatesPage.jsx` | Persisted processing/retry/review state and bounded active polling. |
| `src/pages/CandidatesPage.jsx` | Single transfer progress and completion-aware form save. |
| `src/services/assignedCandidatesApi.js` | Shared 202/status polling helper used by single and bulk flows. |
| `supabase/migrations/20261125210111_cv_transfer_identity_and_storage_integrity.sql` | Forward schema, transfer/claim functions, normalized reference guards and reviewed cleanup CAS. |

## Authorized rollout update

On 26 November 2026 IST, the user authorized committing and pushing to `main` and
applying the Supabase migration. The migration applied successfully to
`owheruvatjcfqwsejnmo` (ATS FYNDBRIDGE). Before application, the branding queue had
no active or unfinished jobs and the local/remote main branches matched. The new
transfer gate rejects old-backend transfers during the brief schema/application
rollout interval; the rest of the site was not paused. New service-only tables,
RLS, trigger enablement, URL normalization and role privileges were checked on the
hosted database. No production cleanup plan was applied and no historical CV was
queued or rewritten. Git push triggers the existing Vercel Git deployment; its
final status is reported separately in chat.
