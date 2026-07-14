# FYNDBRIDGE ATS — Reporting Context

> Repository-derived reporting reference. This file records the current application and database behavior found in source files on 2026-07-14. It is not a data export and contains no credentials or personal records.

## 1. Purpose and evidence rules

This document is intended to be the shared context for future ATS reports, dashboards, SQL, exports, and KPI definitions. It separates:

- **Confirmed** — directly present in current source, migrations, routes, controllers, services, or UI constants.
- **Derived** — a reasonable reporting interpretation of confirmed fields and code behavior; validate with the report owner before treating it as a KPI contract.
- **Ambiguous / unverified** — conflicts, legacy compatibility fields, or facts that require a live Supabase query or business confirmation.

The repository was inspected across `src/`, `server/`, `supabase/migrations/`, `server/supabase-*.sql`, routes, controllers, services, utilities, pages, and existing documentation. Live production row counts and the deployed schema were not queried in this pass.

## 2. Application architecture and reporting boundaries

### Confirmed

- Frontend: React 19 + Vite (`src/`, `package.json`), with page-level modules for Candidates, Clients, Mandates/Jobs, Dashboard, Attendance, Invoice, and administration.
- Backend: Express (`server/src/app.js`) with authenticated `/api/*` routes and Supabase service-role access through `server/src/services/supabaseAdmin.js`.
- Frontend requests use `src/services/apiClient.js`; private API requests receive the Supabase access token.
- Main authenticated routes:
  - `/api/candidates`
  - `/api/clients`
  - `/api/jobs` (UI label: Mandates)
  - `/api/dashboard`
  - `/api/attendance`
  - `/api/invoice` (admin-only middleware)
  - `/api/notifications`, `/api/admin`, `/api/performance`, `/api/user-profiles`, `/api/user-preferences`, `/api/presence`, `/api/documents`, `/api/resumes`.
- Supabase is used both directly from frontend services in limited areas and through the authenticated Express API. Reporting should prefer the server-side API/query semantics where they contain deduplication, permissions, or compatibility logic.

### Reporting implication

The database is not a single flat fact table. Candidate history is association-grained; clients may have multiple physical rows in the same client group; mandates are jobs; attendance is one row per employee/date; invoices are financial documents linked to invoice entities. Every report must state its grain.

## 3. Core entities and relationships

### 3.1 Candidates

**Table:** `public.candidates` (migration/source: `server/supabase-candidate-associations.sql` and later migrations).

Confirmed columns:

- `id uuid primary key`
- `candidate_display_id text unique` (display identifier; allocator uses `CA` prefix in candidate controller)
- `full_name text not null`
- `email text`, `mobile_number text not null`
- `city`, `state`, `location`
- `current_designation`, `current_company`, `current_organisation`
- `experience_years numeric`, `notice_period integer`
- `open_to_relocate text` with current check values `'true'`, `'false'`, `'NA'`
- `skills text[]`, `education`
- CV fields: `cv_link`, `cv_file_hash`, `cv_storage_path`, `resume_url`
- `source` default `manual`
- audit fields `created_by`, `updated_by`, `created_at`, `updated_at`.

The candidate row is the person identity/master record. It does not itself carry the current client/mandate status used by the Candidates list.

### 3.2 Candidate associations

**Table:** `public.candidate_associations`.

One row represents a candidate’s placement/relationship with a client and/or mandate. Confirmed columns:

- `id uuid primary key`
- `candidate_id uuid not null references candidates(id) on delete cascade`
- `client_id uuid references clients(id) on delete set null`
- `job_id uuid references jobs(id) on delete set null` (added by later schema upgrade)
- denormalized display fields: `client_name`, `job_title`
- ownership: `consultant_name`, `consultant_user_id`
- `status text not null default 'Interested'`
- compensation/lifecycle: `current_salary`, `expected_salary`, `offered_ctc`, `date_of_joining`, `notes`
- audit fields `created_by`, `updated_by`, `created_at`, `updated_at`.

The Candidates API joins candidates to `candidate_associations(*)`. If association filters are supplied it uses an inner relation; otherwise candidates without associations are also returned. A candidate with multiple associations is flattened into multiple API rows. Therefore:

- **Candidate people count:** distinct `candidates.id`.
- **Candidate pipeline/placement count:** distinct `candidate_associations.id` (or association rows, depending on the requested event grain).
- Never count flattened API rows as people without deduplication.

### 3.3 Clients and client groups

**Table:** `public.clients` (base schema plus `server/supabase-clients-module-upgrade.sql` and related migrations).

Confirmed current/compatibility fields include:

- identity: `id`, `client_group_id`, `client_display_id`, `name`, `client_name`
- contact: `contact`, `contact_person`, `phone`, `mobile`, `email`, `designation`, `linkedin`
- geography/classification: `city`, `state`, `location`, `region`, `sector`
- ownership: `consultant_name`, `consultant_user_id`
- lifecycle: `status`, `connected_on_date`, `contract_signed`
- commercial/contract: `terms_signed_type`, `terms_signed_custom`, `terms_value`, `billing_entity`, `gstin`, `pan`, `address_on_invoice`, `contract_document`, `contract_pdf_url`, `contract_pdf_storage_path`
- notes/legacy follow-up: `notes`, `comments`, `follow_up_date`
- timestamps: `created_at`, `updated_at`.

`client_group_id` is made non-null by the upgrade migration and is the grouping key used by dashboard code. `dashboardController.dedupeClients()` groups by `client_group_id` (falling back to `id`). Thus:

- **Physical client row count:** count `clients.id`.
- **Business/client-group count:** count distinct `client_group_id` (fallback `id`).
- Dashboard client KPIs and status charts use deduplicated client groups, not blindly every physical row.

### 3.4 Mandates / jobs

**Table:** `public.jobs` (UI label: Mandates).

Confirmed columns:

- `id uuid primary key`, `job_display_id text unique`
- `client_id uuid not null references clients(id) on delete cascade`
- `title text not null`, `city`, `state`, `vertical`
- `consultants text[] not null default '{}'`, `team_lead text`
- `budget text`, `salary_min`, `salary_max`
- `mandate_status text default '-'`, compatibility `status text not null default '-'`
- `allocation_date date`
- `experience_label`, `experience_min`
- progress counters: `completion`, `success_count`, `rejected_by_client`
- `open_positions`, `skills text[]`, `notes`
- JD fields `jd_url`, `jd_storage_path`
- `created_at`, `updated_at`.

The job controller returns compatibility aliases: `mandate_id=id`, `role=title`, `client/client_name`, `consultant=first consultants[]`, `priority=mandate_status`, and normalizes status to `Ongoing`, `Completed`, `Scrapped`, or `-`.

### 3.5 Users, profiles, roles, and assignment references

- `public.user_profiles`: `user_id text unique`, `name`, `email`, employee contact fields, timestamps.
- `public.profiles`: auth-linked profile (`id references auth.users`, `email`, `full_name`).
- `public.admin_users`: role/access records; current role check is `admin` or `super_admin`, with `is_super_admin` compatibility boolean.
- Candidate/client ownership generally stores both a display name and (where supported) `*_user_id`. Mandate consultant assignment is stored as a `text[]` of names plus optional request-side user IDs; the controller resolves names/IDs against `user_profiles` and `profiles`.
- `employee_statuses` tracks `active`, `on_leave`, or `inactive`; inactive employees are excluded from active assignment/team-attendance profiles.

## 4. Status registries and meanings

### 4.1 Candidate status

The canonical list is defined in both `src/utils/candidateStatuses.js` and `server/src/services/candidateStatuses.js`:

1. Interested
2. In Discussion
3. Not Interested
4. Interview
5. Client Submission
6. Offered
7. Hired
8. Offer Declined
9. Dropout
10. Rejected by Recruiter
11. Rejected by Client

`-` is the dashboard/unset display state, not a selectable valid saved candidate status. The server validates and canonicalizes status values. Status belongs to an association in the normal pipeline.

### 4.2 Client status

The client controller’s allowed list is:

- Active
- Inactive
- Converted
- Not Converted
- Follow Up Required
- Not Hiring
- Not Adding Consultants
- Didn't Pick Up

Dashboard compatibility also includes `-` for an unset/unknown status. The clients module migration normalizes legacy values outside the recognized list to `Not Converted`.

### 4.3 Mandate status

Canonical list: `Ongoing`, `Completed`, `Scrapped`. Legacy values `Closed`, `Filled`, `Open`, `Active`, `Scrap`, and priority values `P1/P2/P3` are migrated/normalized by `server/supabase-clients-jobs-schema.sql` and `server/src/controllers/jobController.js`; do not mix legacy and canonical values in a report without stating the mapping.

### 4.4 Attendance status

`attendance_records.status` check values:

`not_marked`, `clocked_in`, `present`, `on_leave`, `half_day_leave`, `holiday`, `weekly_off`, `correction_pending`, `corrected`, `absent`.

The current team-today service treats `present` and `corrected` as Present; approved leave rows can classify a person as Leave/Half Day Leave; super-admins and inactive employees are excluded from the active team profile set.

## 5. Candidate workflow and data lifecycle

### Confirmed from `candidateController.js`

1. Candidate creation validates identity and required association references (`client_id` and `job_id`).
2. Duplicate matching considers candidate identity and concrete client/mandate association. The API can reject an exact association, request an explicit duplicate action, update the current candidate, or add an association.
3. CV input is processed/uploaded only as part of the create/update flow; failed writes clean up an uploaded temporary result.
4. A candidate master row is inserted/updated, then an association row is inserted/updated.
5. Assignment notifications can be sent when a consultant is assigned.
6. Setting an association to `Hired` calls `syncMandateStatusForJob`, which can update the linked mandate state based on hired associations.
7. Candidate list pagination is capped at 100 rows/request; default is 50. It supports search, status, client, mandate, consultant, period, salary, experience, city, state, sorting, and AST AI filters.
8. `GET /api/candidates/:id` addresses an association ID first, not necessarily a candidate master ID; `GET /api/candidates/by-candidate/:candidateId/associations` returns all associations for a person.

### Reporting cautions

- A candidate can have multiple historical/current associations. “Total candidates” and “pipeline records” are different metrics.
- Association `created_at` is the date used by the candidate period filter in `listCandidates`; this is not necessarily the candidate’s master creation date.
- `date_of_joining` is stored on an association but no universal “placement date” field is enforced. A placement report must declare whether it uses status transition history (not currently stored), `date_of_joining`, or association creation date.
- There is no status-history table found in the inspected repository; current status is overwrite-style.

## 6. Client workflow and follow-ups

### Confirmed

- Client create/update/delete/list logic is in `server/src/controllers/clientController.js` and `/api/clients`.
- Duplicate checks cover client/group identity and contact details.
- Consultant ownership is validated against user/profile references and active employee assignments.
- Follow-ups have a normalized child table `client_follow_ups`:
  - `id`, `client_id`, `follow_up_number`, `follow_up_date`, `follow_up_comments`, timestamps
  - unique `(client_id, follow_up_number)` and a later unique date index `(client_id, follow_up_date)`.
- Legacy `clients.follow_up_date` and `comments/notes` are migrated/copied into the child table by `server/supabase-client-follow-ups-source-of-truth.sql`; the child table is the intended source of truth for multiple follow-ups.
- Follow-up endpoints: `POST /api/clients/:id/follow-ups`, `PATCH /api/clients/:id/follow-ups/:followUpId`, `DELETE /api/clients/:id/follow-ups/:followUpId`.
- Due follow-ups can create deduplicated notifications in `notifications` using `action_type='client_follow_up_due'`, recipient, client, follow-up ID/date.

### Derived reporting formulas

- Due follow-up count = child follow-ups whose `follow_up_date` is on/before the as-of date and are not deleted (there is no child-row status field; UI/controller behavior must be checked for overdue semantics).
- “Clients with follow-up” should use `client_follow_ups`, not only the legacy parent date.
- If grouping by client, use `client_group_id`; if measuring physical records, use `clients.id`.

### Ambiguity

The current repository contains both legacy parent follow-up fields and normalized child follow-ups. A live production query is required to confirm whether all historical rows have been migrated and whether any reports still intentionally use the legacy field.

## 7. Mandate workflow and candidate linkage

### Confirmed

- Mandate CRUD is `/api/jobs` and is implemented by `jobController.js`.
- A mandate must reference an existing client; duplicate role/title per client is rejected.
- Allocation date is stored in `jobs.allocation_date`; the response falls back to `created_at::date` when null.
- Consultant assignment is an array (`jobs.consultants`); team lead is a single text value. Assignment validation resolves against user profiles and rejects typed names that are not selected records.
- Assignment notifications are written to `notifications` with `mandate_id`, `client_id`, `role_type` (`consultant` or `team_lead`), and `mark_read_assignment` action type.
- Candidate associations can reference both `client_id` and `job_id`. `candidateController.syncMandateStatusForJob()` links hired associations back to a job.
- Mandate list filters cover job ID, consultant, team lead, client, role, location, budget, experience, status, vertical, comments, allocation date, and JD.

### Recommended report grains

- Mandate inventory: one row per `jobs.id`.
- Client mandate count: count jobs grouped by `client_id` or by the client’s `client_group_id` if business-level deduplication is required.
- Consultant workload: unnest `consultants`; one job may contribute to multiple consultant assignments.
- Hires by mandate: count distinct candidate association IDs whose current status is `Hired`, grouped by `job_id`; confirm whether duplicate associations are allowed for the intended report.

## 8. Dashboard behavior and time windows

### Confirmed implementation

`server/src/controllers/dashboardController.js` loads:

- `user_profiles` for consultant options
- `clients`
- `candidates`
- `candidate_associations`
- `jobs`

It computes KPIs, status distributions, billing-entity data, cumulative status trends, candidate funnel, consultant performance, recent activity, and section-level errors. Client rows are deduplicated by `client_group_id`; candidate and association data are kept separate; mandate rows are jobs.

`server/src/utils/dashboardPeriod.js` supports:

- `This Month`
- `Month YYYY-MM`
- `FY YYYY-YY` (April 1 through March 31)
- `FY YYYY-YY Q1` through `Q4`
- legacy `Q1`–`Q4`
- `Till This Date`

All period ends are capped at today (local server date) rather than including future dates. Month trend buckets are daily; FY/quarter buckets are monthly. Trends are cumulative running counts of records created/dated in each bucket, not a historical snapshot of status at each date.

### Important date semantics

- Client trends use connected/created compatibility dates through dashboard code.
- Candidate trends use association creation dates and association statuses.
- Mandate trends use allocation/creation compatibility dates and job status.
- Dashboard status charts represent current status values filtered into the selected period, not a full status-transition history.
- Consultant filtering uses consultant ownership fields, candidate association consultant, and mandate consultant/team-lead arrays as appropriate; access can be restricted to self by `dashboardAccess`.

## 9. Attendance and leave model

### Tables

From `supabase/migrations/20260712094233_attendance_leave_backend.sql` and follow-on migrations:

- `attendance_records`: one row per `(user_id, attendance_date)`; clock timestamps, worked minutes, status, source, correction/leave links, audit fields.
- `attendance_correction_requests`: requested and existing times, reason, approval state, reviewer, one pending request per user/date.
- `leave_requests`: date range, full/half-day type, reason, charged/paid/loss-of-pay days, balance snapshots, JSON calculation breakdown, approval state; pending/approved date ranges cannot overlap.
- `leave_ledger`: append-only-ish entries for opening balance, accrual, leave used, adjustment, reversal; amount sign is constrained by entry type; linked leave request where applicable.
- `company_holidays`: active holiday date/name/type; unique active date.
- `attendance_permissions`: permission keys with access level `admins` or `super_admins`.
- `employee_statuses`: `active`, `on_leave`, `inactive`.

### API and calculations

`/api/attendance/month` builds a day-by-day calendar, overlays holidays, weekly off (Sunday), approved/pending/rejected leave, corrections, future dates, and attendance records. Its KPIs count working days, present/corrected records, leave dates, corrections, unmarked dates, holidays, and worked minutes.

`/api/attendance/team` requires attendance view-all permission, excludes super-admins and inactive employees from active profiles, and returns each employee’s monthly summary plus today’s Present/Leave/Unmarked lists.

Leave balance is financial-year based (`FY YYYY-YY`, April–March). `attendanceService` ensures monthly accruals, carry-forward, approved leave debits, and adjustments through `leave_ledger`; as-of date affects which accruals are included.

### Reporting cautions

- “Present today” is not simply `attendance_records.status='present'`: corrected records count as present, approved leave can classify the person as leave, and super-admin/inactive filtering applies to team summaries.
- Unmarked excludes future dates, holidays, weekly off, leave, and the current date in the monthly service’s historical unmarked calculation.
- Leave days are calculated with sandwich/holiday logic in `attendanceUtils`; use `calculation_breakdown` or the service rather than reimplementing date arithmetic casually.

## 10. Invoice and financial reporting model

### Tables

- `invoice_entities`: legal/billing entity master, display ID, address/tax fields, billing entity (`FCS` or `FCAPL`), GST component/rates, and model inputs.
- `invoices`: stored invoice document with `invoice_entity_id`, `billing_entity`, invoice number/display ID, financial year, sequence, invoice date, consultant/candidate labels, model inputs, taxable/tax/rounding/grand totals, PDF storage path, timestamps.
- `invoice_pdf_versions`: invoice ID, storage path, created timestamp; supports regeneration history.

### Confirmed calculation/routing behavior

- Invoice routes are admin-only.
- `invoiceService.js` defines models: `joining_percentage`, `joining_flat_fee`, `retainer`, `jra_adjustment_percentage`, `jra_adjustment_flat_fee`, `project`, `others`.
- Billing entities are `FCS` and `FCAPL`; GST components are `IGST` or `CGST_SGST`.
- Invoice number sequence is unique by `(billing_entity, financial_year, sequence_number)`; number format is `${billingEntity}/${financialYear}/${3-digit sequence}` (`FB` prefix for FCS, `FCAPL` for FCAPL).
- Preview does not persist; generate/commit persists the invoice and PDF; regeneration adds a PDF version and updates the invoice’s current PDF path.
- Taxable amount, GST, rounding, grand total, and amount-in-words are generated by `calculateInvoice`/`createInvoicePdf`; reports should use stored numeric columns for totals.

### Financial reporting cautions

- Invoice `consultant_name` and `candidate_name` are denormalized labels, not foreign keys.
- Invoice date, financial year, and storage version date are different concepts.
- Do not count PDF versions as invoices; count `invoices.id` or unique invoice number.
- The invoice module has historical migrations and compatibility fields; verify deployed constraints before bulk financial reconciliation.

## 11. Permissions, visibility, and row-level security

### Confirmed

- Express routes use `attachUser` and `requireAuth`; invoice additionally uses `requireAdmin`.
- Admin/super-admin behavior is implemented in `server/src/services/adminAccess.js`, `dashboardAccess.js`, attendance permission checks, and admin middleware.
- Column visibility/editability is configurable through `column_permissions` for `clients`, `candidates`, and `jobs`, with access modes `everyone`, `admin_disabled`, and `admin_hidden`.
- Record locks exist on clients, candidates, and jobs (`is_locked`, `locked_by`, `locked_at`).
- Attendance team view requires the attendance permission `attendance_view_all`; super-admins bypass attendance permission levels but are excluded from the active employee team list by `buildActiveProfiles`.
- Supabase RLS migrations enable policies on profiles, attendance/leave tables, notifications, invoice tables, and employee status. Server-side service-role queries still apply application-level visibility and assignment rules.

### Reporting consequence

A report run through an authenticated user-facing API may be intentionally scoped differently from a service-role warehouse query. Always record the execution identity/scope and whether super-admin, admin, or self-only visibility was used.

## 12. Notification and audit surfaces

`notifications` stores recipient/sender IDs, optional `mandate_id`/`client_id`, role type, message, pending/read state, action type, follow-up date/ID, attendance entity references, and timestamps. It is an operational notification stream, not a complete audit log.

Entity tables retain `created_at`, `updated_at`, and selected `created_by`/`updated_by` fields. Candidate/client/job current values are overwritten on update; no general field-level history table was found. Therefore “as of date” status reporting cannot be reconstructed reliably from current tables alone unless an event/history source exists outside this repository.

## 13. Recommended KPI definitions (derived; confirm before publishing)

| KPI | Recommended grain/formula | Caveat |
|---|---|---|
| Total candidates | `count(distinct candidates.id)` | Do not count flattened association rows. |
| Active candidate pipeline | distinct `candidate_associations.id` with current status in the selected set | Current status only; no transition history. |
| Hires | distinct association IDs where status = `Hired` | Confirm whether date filter is association creation, joining date, or status-change date. |
| Clients | distinct `client_group_id` (fallback `clients.id`) | Physical rows may exceed business clients. |
| Mandates | count distinct `jobs.id` | One job belongs to one physical client row. |
| Open mandates | jobs with normalized `mandate_status='Ongoing'` | Legacy status mappings must be applied. |
| Consultant workload | count job-assignment pairs after unnesting `jobs.consultants` | One job may count for several consultants. |
| Follow-ups due | child `client_follow_ups` by date/as-of | Confirm legacy parent migration completeness. |
| Present today | team service’s Present list (`present` or `corrected`) after active/super-admin exclusion | Approved leave and correction semantics matter. |
| Leave used | approved leave calculation charged days / `leave_ledger` debits | Sandwich and holiday rules apply. |
| Invoice revenue | sum stored `grand_total` grouped by invoice date/FY/billing entity | Count invoices, not PDF versions. |

## 14. Known ambiguities and items requiring confirmation

1. **Live schema/data:** this pass did not connect to Supabase; deployed columns, row counts, legacy nulls, and migration completion are unverified.
2. **Client identity:** `client_group_id` is the dashboard grouping key, but the business rule for when two physical records should be one client should be confirmed.
3. **Candidate placement date:** no immutable status-transition or placement-event table was found. Confirm whether `date_of_joining`, association `created_at`, or an external source is authoritative.
4. **Historical status reporting:** current status is stored, but status history is not present in inspected schema. Trend charts are cumulative current-row counts by creation/date bucket, not historical snapshots.
5. **Follow-up migration:** both `clients.follow_up_date` and `client_follow_ups` exist. Confirm that all production consumers use the child table and whether legacy values remain intentionally populated.
6. **Mandate status compatibility:** legacy `status`, `priority`, `Open`, `Active`, `Closed`, `Filled`, and `Scrap` values appear in migration compatibility logic. Confirm production cleanup before filtering only canonical values.
7. **Ownership names vs IDs:** several tables store display names as well as optional user IDs. Confirm which field is authoritative for historical ownership when a user changes name.
8. **Invoice source of truth:** stored numeric totals are authoritative for persisted invoices, but invoice entity/model inputs can be edited and regenerated. Confirm whether reports should use original issue values or latest regenerated document values.
9. **Timezone:** API date utilities use local server/browser date helpers in several places while timestamps are `timestamptz`. Confirm the reporting timezone and end-of-day convention.
10. **Retention/deletion:** candidate deletion cascades associations; client deletion cascades jobs. Confirm whether soft-delete/archival exists operationally outside the inspected tables.

## 15. Source index

### Frontend

- `src/App.jsx`, `src/pages/CandidatesPage.jsx`, `src/pages/ClientsPage.jsx`, `src/pages/JobsPage.jsx`, `src/pages/ClientDetailPage.jsx`
- `src/pages/DashboardHome.jsx`, `src/pages/AttendancePage.jsx`, `src/features/attendance/*`
- `src/pages/InvoicePage.jsx`, `src/pages/InvoiceEntityDetailPage.jsx`
- `src/utils/candidateStatuses.js`, `src/utils/mandateStatuses.js`, `src/constants/statusColors.js`
- `src/services/apiClient.js`, `src/services/attendanceApi.js`, `src/services/invoiceApi.js`

### Backend routes/controllers/services

- `server/src/app.js`
- `server/src/routes/candidates.js`, `clients.js`, `jobs.js`, `dashboard.js`, `attendance.js`, `invoice.js`
- `server/src/controllers/candidateController.js`, `clientController.js`, `jobController.js`, `dashboardController.js`, `invoiceController.js`
- `server/src/services/candidateStatuses.js`, `filterEngine.js`, `candidateFilterQuery.js`, `dashboardAccess.js`, `adminAccess.js`
- `server/src/services/attendanceService.js`, `attendanceUtils.js`, `teamAttendanceToday.js`, `employeeStatus.js`, `employeeStatusUtils.js`
- `server/src/services/invoiceService.js`

### Database migrations/schema SQL

- `server/supabase-candidate-associations.sql`
- `server/supabase-clients-jobs-schema.sql`, `server/supabase-clients-module-upgrade.sql`, `server/supabase-client-follow-ups-source-of-truth.sql`, `server/supabase-client-consultant.sql`
- `server/supabase-admin-access-control.sql`, `supabase-user-profiles.sql`, `supabase-notifications.sql`
- `server/supabase-invoice-module.sql`
- `supabase/migrations/20260712094233_attendance_leave_backend.sql`
- `supabase/migrations/20260712101329_leave_financial_year_carry_forward.sql`
- `supabase/migrations/20260712110052_attendance_leave_balance_management.sql`
- `supabase/migrations/20260713082653_employee_management_backend.sql`
- `supabase/migrations/20260712082540_page_view_permissions.sql`

## 16. Minimal validation checklist for a future report

Before publishing a report:

1. State the grain: person, association, client group, physical client row, mandate, assignment, attendance day, leave day, invoice, or PDF version.
2. State the date field and timezone.
3. Apply canonical status normalization and document legacy mappings.
4. Deduplicate candidates and clients according to the definitions above.
5. Apply visibility scope (self/admin/super-admin) and active/inactive employee rules.
6. Use child follow-ups and attendance/leave service semantics where applicable.
7. Reconcile totals against API response counts and database constraints.
8. Flag any KPI that depends on a missing status-history/event table rather than presenting it as historical fact.
