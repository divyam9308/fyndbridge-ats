# Fyndbridge ATS — Database Documentation

## Platform

**Supabase** (PostgreSQL) — managed cloud Postgres with:
- Row Level Security (RLS) policies for auth-based access
- Supabase Auth (`auth.users`) for user management
- Supabase Storage for file objects (CVs, JDs, contracts)
- Triggers and stored functions for display ID auto-assignment

---

## Migration Files

All SQL migration scripts are in `server/`. They are applied manually via the Supabase SQL editor (not auto-migrated). Apply them **in order**:

| File | Purpose |
|---|---|
| `supabase-clients-schema.sql` | Initial `clients` table |
| `supabase-clients-jobs-schema.sql` | `clients` + `jobs` tables, indexes, mandate_status migration |
| `supabase-candidate-associations.sql` | `candidates` + `candidate_associations` + `profiles` + `handle_new_user` trigger |
| `supabase-display-ids.sql` | Display ID columns, sequences, triggers for CA/CL/JB IDs |
| `supabase-client-shared-display-ids.sql` | Shared display ID helpers |
| `supabase-jobs-schema.sql` | Extended jobs schema |
| `supabase-clients-module-upgrade.sql` | Client table upgrade (billing entity, contract fields, consultant) |
| `supabase-client-billing-entity.sql` | `billing_entity` column on clients |
| `supabase-client-consultant.sql` | `consultant` column on clients |
| `supabase-client-contract-fields.sql` | Contract-related columns on clients |
| `supabase-candidate-cv-hash.sql` | `cv_file_hash`, `cv_storage_path` columns on candidates |
| `supabase-candidate-skills-column.sql` | `skills` column on candidates |
| `supabase-duplicates-support.sql` | Duplicate candidate support (soft-link columns) |
| `supabase-user-profiles.sql` | Extended `profiles` table fields |
| `supabase-user-preferences.sql` | `user_preferences` table |
| `supabase-profile-rls-policies.sql` | RLS policies for `profiles` table |

---

## Tables

### `public.candidates`

Stores the core candidate record (personal info, CV link, parsed resume data).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `candidate_display_id` | `text` UNIQUE NOT NULL | Auto-assigned: `CA1`, `CA2`, … (trigger) |
| `client_id` | `uuid` FK → `clients.id` | Optional — initial/primary client link |
| `full_name` | `text` NOT NULL | |
| `email` | `text` | |
| `mobile_number` | `text` NOT NULL | |
| `city` | `text` | |
| `state` | `text` | |
| `location` | `text` | Combined city+state string |
| `current_designation` | `text` | |
| `current_company` | `text` | |
| `current_organisation` | `text` | Alt field, same semantic as current_company |
| `experience_years` | `numeric` | |
| `notice_period` | `integer` | In days |
| `open_to_relocate` | `boolean` | Nullable — no default |
| `skills` | `text[]` | Array of skill strings, default `'{}'` |
| `education` | `text` | Formatted multi-line education string |
| `cv_link` | `text` | Public Supabase Storage URL for CV |
| `cv_file_hash` | `text` | SHA-256 of CV file (used for dedup) |
| `cv_storage_path` | `text` | Object path inside `resumes` bucket |
| `resume_url` | `text` | Legacy alias for `cv_link` |
| `linkedin_url` | `text` | |
| `source` | `text` | `'manual'` or `'parsed'`, default `'manual'` |
| `created_by` | `uuid` | Auth user UUID |
| `updated_by` | `uuid` | Auth user UUID |
| `created_at` | `timestamptz` NOT NULL | `now()` |
| `updated_at` | `timestamptz` NOT NULL | `now()` |

**Indexes:**
- `candidates_full_name_idx` on `full_name`
- `candidates_mobile_number_idx` on `mobile_number`
- `candidates_city_idx` on `city`
- `candidates_state_idx` on `state`
- `candidates_experience_years_idx` on `experience_years`
- `candidates_client_id_idx` on `client_id`
- `candidates_candidate_display_id_key` (UNIQUE) on `candidate_display_id`

---

### `public.candidate_associations`

Links a candidate to a specific client and/or job. Each row = one candidate-client-job relationship.
One candidate can have multiple associations (e.g., submitted to multiple clients/roles).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `candidate_id` | `uuid` NOT NULL FK → `candidates.id` | Cascade delete |
| `client_id` | `uuid` FK → `clients.id` | Optional, set null on delete |
| `job_id` | `uuid` FK → `jobs.id` | Optional, set null on delete |
| `consultant_name` | `text` | Recruiter name |
| `client_name` | `text` | Denormalized client name (for display) |
| `job_title` | `text` | Denormalized job title (for display) |
| `status` | `text` NOT NULL | Default `'Interested'` (see status list below) |
| `current_salary` | `integer` | In rupees |
| `expected_salary` | `integer` | In rupees |
| `offered_ctc` | `integer` | In rupees |
| `date_of_joining` | `date` | |
| `notes` | `text` | Recruiter notes |
| `created_by` | `uuid` | |
| `updated_by` | `uuid` | |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**Valid `status` values** (from `src/utils/candidateStatuses.js`):
- `Interested`, `Screening`, `Shortlisted`, `Interview Scheduled`, `Interviewed`
- `Offer Extended`, `Offer Accepted`, `Offer Declined`, `Joined`, `Rejected`, `On Hold`, `Duplicate`

**Indexes:**
- `candidate_associations_candidate_id_idx`
- `candidate_associations_job_title_idx`
- `candidate_associations_client_name_idx`
- `candidate_associations_consultant_name_idx`
- `candidate_associations_status_idx`
- `candidate_associations_current_salary_idx`
- `candidate_associations_client_id_idx`
- `candidate_associations_job_id_idx`

---

### `public.clients`

Stores client (company) information.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `client_display_id` | `text` NOT NULL | Auto-assigned: `CL1`, `CL2`, … (trigger) |
| `name` | `text` UNIQUE NOT NULL | |
| `contact` | `text` | Contact person name |
| `phone` | `text` NOT NULL | |
| `email` | `text` | |
| `city` | `text` | |
| `state` | `text` | |
| `status` | `text` NOT NULL | Default `'Active'` |
| `notes` | `text` | |
| `billing_entity` | `text` | Legal billing entity name |
| `consultant` | `text` | Assigned consultant |
| `contract_document_url` | `text` | Public URL to contract PDF in `contract-pdfs` bucket |
| `contract_storage_path` | `text` | Object path in `contract-pdfs` bucket |
| `follow_ups` | `jsonb` | Array of follow-up entries `[{ date, note, by }]` |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**Indexes:**
- `clients_name_idx` on `name`
- `clients_client_display_id_idx` on `client_display_id`

---

### `public.jobs`

Stores job mandates (open positions).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_display_id` | `text` UNIQUE | Auto-assigned: `JB1`, `JB2`, … |
| `client_id` | `uuid` NOT NULL FK → `clients.id` | Cascade delete |
| `title` | `text` NOT NULL | Role title |
| `city` | `text` | |
| `state` | `text` | |
| `consultants` | `text[]` | Array of consultant names, default `'{}'` |
| `team_lead` | `text` | |
| `budget` | `text` | Budget range string (e.g. `'20-25 lac'`) |
| `mandate_status` | `text` | `'Ongoing'`, `'Scrapped'`, `'Completed'` |
| `vertical` | `text` | Industry vertical / domain |
| `allocation_date` | `date` | When the mandate was allocated |
| `status` | `text` NOT NULL | Default `'-'` |
| `salary_min` | `integer` | |
| `salary_max` | `integer` | |
| `experience_label` | `text` | Human-readable (e.g. "5-8 years") |
| `experience_min` | `integer` | |
| `completion` | `integer` NOT NULL | % complete, default `0` |
| `success_count` | `integer` NOT NULL | Candidates joined, default `0` |
| `rejected_by_client` | `integer` NOT NULL | default `0` |
| `jd_url` | `text` | Public URL to JD PDF in `jds` bucket |
| `jd_storage_path` | `text` | Object path in `jds` bucket |
| `open_positions` | `integer` NOT NULL | Default `1` |
| `skills` | `text[]` | Required skills, default `'{}'` |
| `notes` | `text` | |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**Indexes:**
- `jobs_client_id_idx`
- `jobs_title_idx`
- `jobs_display_id_idx`
- `jobs_mandate_status_idx`

---

### `public.profiles`

One row per Supabase auth user. Auto-populated via trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK FK → `auth.users.id` | |
| `email` | `text` UNIQUE NOT NULL | |
| `full_name` | `text` | From user metadata |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**Trigger:** `on_auth_user_created` → calls `handle_new_user()` on every new auth user insert to populate this table.

---

### `public.user_preferences`

Per-user application preferences (column visibility, default filters, etc.).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `auth.users.id` | |
| `preferences` | `jsonb` | Arbitrary key-value preferences |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

---

## Relationships Diagram

```
auth.users (Supabase Auth)
    │  (trigger: on_auth_user_created)
    ▼
public.profiles (1:1 with auth.users)

public.clients (CL###)
    │
    ├── public.jobs (JB###)  [client_id FK]
    │       │
    │       └── public.candidate_associations [job_id FK]
    │
    └── public.candidate_associations [client_id FK]
                │
                └── public.candidates (CA###) [candidate_id FK]
```

A candidate can have **multiple** `candidate_associations` rows — one per client/job they are being tracked for.
The `candidates` table also has a direct `client_id` FK (the initial/primary association), but the `candidate_associations` table is the canonical many-to-many link.

---

## Display ID System

### Candidates (`CA###`)

**Sequence-based with gap-filling (custom logic in controller)**:

1. A PostgreSQL sequence `candidate_display_id_seq` was created and initialized to the current max CA number
2. A trigger `candidates_display_id_before_insert` calls `assign_candidate_display_id()` which uses `nextval('candidate_display_id_seq')` to assign `CA{n}`
3. However, the backend controller also has **gap-filling logic** in `getNextCandidateDisplayId` — it queries all existing `candidate_display_id` values, finds the lowest unused integer (filling gaps left by deleted candidates), and returns that as the preview

> **Note**: There is a known tension between the sequence (which monotonically increases) and the gap-filling preview. The actual assignment at insert time uses the sequence, while the `/next-display-id` endpoint shows the gap-filled value.

### Clients (`CL###`)

**Gap-filling via stored function**:

`assign_client_display_id()` (trigger: `clients_display_id_before_insert`):
```sql
-- Finds the lowest positive integer not yet used as a CL number
with used_numbers as (
  select substring(client_display_id from 3)::bigint as number
  from public.clients where client_display_id ~ '^CL[0-9]+$'
),
candidates as (
  select generate_series(1, greatest(max(number), 0) + 1) as number
)
select candidates.number
from candidates left join used_numbers on ...
where used_numbers.number is null
order by candidates.number limit 1;
```

### Jobs (`JB###`)

Managed in `jobController.js` — the controller queries existing job_display_id values and assigns the next available `JB{n}`.

---

## Supabase Storage Buckets

| Bucket Name | Contents | Access |
|---|---|---|
| `resumes` | Candidate CV files (PDF/DOC/DOCX) | Public read |
| `jds` | Job Description PDFs | Public read |
| `contract-pdfs` | Client contract documents | Public read |

Files are addressed by their object path. The public URL pattern is:
```
https://<supabase-project>.supabase.co/storage/v1/object/public/<bucket>/<object-path>
```

CV files are stored as `{sha256_hash}{.ext}` — this provides automatic deduplication (same file = same hash = same path = upsert-safe).

---

## Supabase Auth

- Auth provider: **Email + Password** (Supabase built-in)
- Optional: Google OAuth (configurable in Supabase dashboard)
- **Frontend domain enforcement**: Only `@fyndbridge.in` emails are accepted (enforced in `AuthContext.jsx`)
- JWT from `supabase.auth.getSession()` is sent as `Authorization: Bearer <token>` to the backend
- Backend validates with `supabase.auth.getUser(token)` using the anon key

---

## Row Level Security (RLS)

RLS policies are defined in `supabase-profile-rls-policies.sql`. The profiles table restricts users to only reading/editing their own row.

> **Note**: The backend uses `SUPABASE_SERVICE_ROLE_KEY` which **bypasses all RLS** — all backend DB operations are unrestricted. RLS only applies to frontend direct Supabase client calls (if any).

---

## Known Issues / TODOs

- **`candidates` has both `current_company` and `current_organisation`**: These are semantically identical fields that both exist. The codebase uses `current_organisation` as the primary but falls back to `current_company`.
- **Denormalized `client_name` and `job_title` in `candidate_associations`**: These are stored as plain text copies rather than always being resolved from the FK. This means they can drift if client/job names are updated.
- **No `updated_at` auto-update trigger**: The `updated_at` column exists but is not auto-updated by a trigger — it must be manually set in UPDATE queries by the controller.
- **Soft deletes not implemented**: All deletions are hard deletes (`DELETE` SQL), no `deleted_at` or `is_deleted` column.
- **No full-text search index**: Filtering is done in-memory on the backend (all rows fetched, then filtered by `filterEngine.js`). No PostgreSQL full-text search or `pg_trgm` index for scalability.
