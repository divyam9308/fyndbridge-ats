# Public Open Roles deployment runbook

This runbook covers the Public Open Roles and Applied Candidates migration and
its production environment. The repository migration is intentionally not
applied by development or test commands.

## Production prerequisites

Take a database backup and confirm that
`20260720093624_mandate_priority_statuses.sql` has already been applied. The
public workflow treats only exact canonical `Ongoing (P1)` as open; the legacy
`status` column is not its source of truth.

Run these read-only checks against production before applying the migration:

```sql
show server_version_num;

select mandate_status, status, count(*)
from public.jobs
group by mandate_status, status
order by mandate_status, status;

select candidate_id, job_id, count(*)
from public.candidate_associations
where job_id is not null
group by candidate_id, job_id
having count(*) > 1;

select
  to_regclass('public.candidates_normalized_email_unique') as email_unique_index,
  to_regclass('public.candidates_normalized_mobile_unique') as mobile_unique_index;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'public-applications' or name = 'public-applications';

select bucket_id, count(*) as object_count,
  min(created_at) as oldest_object,
  max(created_at) as newest_object
from storage.objects
where bucket_id = 'public-applications'
group by bucket_id;

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    coalesce(qual, '') ilike '%public-applications%'
      or coalesce(with_check, '') ilike '%public-applications%'
  );

select pubname, puballtables
from pg_publication
where pubname = 'supabase_realtime';

select namespace.nspname as published_schema
from pg_publication_namespace publication_namespace
join pg_publication publication
  on publication.oid = publication_namespace.pnpubid
join pg_namespace namespace
  on namespace.oid = publication_namespace.pnnspid
where publication.pubname = 'supabase_realtime'
  and namespace.nspname = 'public';

select attnames, rowfilter
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'candidate_associations';

select relreplident
from pg_class
where oid = 'public.candidate_associations'::regclass;

select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'candidate_associations'
order by grantee, privilege_type, column_name;
```

Expected results:

- Every job has one of the five canonical mandate statuses and `status` equals
  `mandate_status`.
- PostgreSQL is version 15 or newer. The `supabase_realtime` publication exists,
  is not an all-tables publication, does not publish the entire `public` schema,
  and its `candidate_associations` entry has no row filter requiring manual
  preservation. `candidate_associations.relreplident` is `d` (default).
- The candidate/mandate duplicate query returns no rows. Do not automatically
  delete or merge rows if it returns data; review them before deployment.
- Both normalized candidate identity indexes resolve to a relation.
- No conflicting `public-applications` bucket or Storage policy exists. If the
  exact bucket or any objects already exist, stop and inspect their ownership,
  purpose, paths, retention needs, and backup before proceeding. The migration
  aborts instead of reconfiguring or deleting an existing bucket or its objects.
- `public.public_applications` and
  `public.public_application_rate_limits` do not already exist from a partial
  manual deployment.

The migration intentionally aborts when these safety prerequisites are not met.

## Environment variables

Keep all secret values in the deployment environment. Never commit them.

Required server variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
TURNSTILE_SECRET_KEY
PUBLIC_APPLICATION_RATE_LIMIT_SALT
PUBLIC_APPLICATION_FORM_TOKEN_SECRET
```

`PUBLIC_APPLICATION_RATE_LIMIT_SALT` and
`PUBLIC_APPLICATION_FORM_TOKEN_SECRET` must be separate, long, randomly
generated secrets.

Required Vite variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_TURNSTILE_SITE_KEY
```

Optional abuse-control tuning variables and their code defaults:

```text
PUBLIC_APPLICATION_PARSE_RATE_LIMIT=10
PUBLIC_APPLICATION_PARSE_RATE_WINDOW_SECONDS=900
PUBLIC_APPLICATION_SUBMIT_RATE_LIMIT=5
PUBLIC_APPLICATION_SUBMIT_RATE_WINDOW_SECONDS=3600
PUBLIC_APPLICATION_MIN_COMPLETION_MS=3000
PUBLIC_APPLICATION_FORM_TOKEN_MAX_AGE_MS=7200000
PUBLIC_APPLICATION_CONVERSION_STALE_MS=900000
```

Local development may explicitly use:

```text
PUBLIC_APPLICATION_ALLOW_UNSAFE_DEV=true
```

Never set `PUBLIC_APPLICATION_ALLOW_UNSAFE_DEV=true` in production. Production
fails closed when the rate-limit salt, form-token secret, Turnstile secret, or
durable database rate limiter is unavailable.

Expired durable rate-limit counters are removed by the rate-limit function
using each row's stored `expires_at`; no separate scheduled cleanup is required.

## Deployment order

1. Back up the database and record the current migration list.
2. Run the prerequisite queries above and resolve any failures without
   automatic destructive cleanup.
3. Apply `20260720093624_mandate_priority_statuses.sql` first if it is not in
   production migration history, then re-run its status checks.
4. Apply
   `supabase/migrations/20260722065251_public_open_roles_and_applications.sql`
   through the normal reviewed Supabase deployment process.
5. Run the post-migration verification below before deploying application code.
6. Configure the production environment variables and deploy backend/frontend
   code together.
7. Smoke-test the public listing, PDF parsing/submission, protected Applied
   Candidates access, CV signed URL, conversion, duplicate handling, and the
   Candidates red-row marker.
8. Manually publish one fully reviewed test mandate only after the checks pass.
9. Configure the main website redirect last:
   `https://fyndbridge.in/open-roles/` to
   `https://ats.fyndbridge.in/open-roles`.

The migration resets every existing mandate to `is_public = false`; applying it
does not publish any role automatically. Its schema, privilege, Storage, and
publication changes are enclosed in an explicit transaction.

## Post-migration verification

```sql
select count(*) as unexpectedly_public_jobs
from public.jobs
where is_public = true;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.public_applications'::regclass,
  'public.public_application_rate_limits'::regclass
);

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('public_applications', 'public_application_rate_limits')
order by table_name, grantee, privilege_type;

select
  has_table_privilege('anon', 'public.public_applications', 'select') as anon_select,
  has_table_privilege('authenticated', 'public.public_applications', 'select') as authenticated_select,
  has_table_privilege('service_role', 'public.public_applications', 'select') as service_select,
  has_table_privilege('service_role', 'public.public_applications', 'insert') as service_insert;

select policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('public_applications', 'public_application_rate_limits');

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'public-applications';

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'public_applications';

select attnames, rowfilter
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'candidate_associations';

select
  has_column_privilege(
    'authenticated',
    'public.candidate_associations',
    'public_application_id',
    'select'
  ) as authenticated_can_select_raw_application_id,
  has_column_privilege(
    'service_role',
    'public.candidate_associations',
    'public_application_id',
    'select'
  ) as service_can_select_raw_application_id;

select page_key, view_permission
from public.page_view_permissions
where page_key = 'applied_candidates';

select table_name, column_key, access_mode
from public.column_permissions
where table_name = 'jobs'
  and column_key = 'public_careers_listing';
```

Expected results:

- `unexpectedly_public_jobs` is zero.
- RLS is enabled on both protected tables.
- `anon` and `authenticated` have no staging-table privileges or policies;
  `service_role` has the required CRUD privileges.
- The bucket is private, limited to exactly `1048576` bytes, and PDF-only.
- `public_applications` is absent from the Realtime publication. Applied
  Candidates uses authenticated Express requests and targeted refetches rather
  than direct browser table access.
- `candidate_associations` remains in Realtime for targeted Candidates refresh,
  but its `attnames` array does not contain `public_application_id`.
  `authenticated_can_select_raw_application_id` is false and
  `service_can_select_raw_application_id` is true; the protected Candidates API
  exposes only `is_public_application_conversion`.
- Both permission seed rows exist. Existing administrator-selected values are
  preserved because seeds use `ON CONFLICT DO NOTHING`.

Also verify through the public HTTP API that role payloads contain only the
documented public allowlist and never contain client identifiers, internal IDs,
consultants, status, storage paths, or internal JD data.

The migration deliberately converts authenticated `candidate_associations`
access and Realtime publication to explicit safe column lists. Preserve the
pre-deployment publication and column-privilege query results. When a future
candidate-association column is added, review its sensitivity and explicitly
add it to the authenticated grant and Realtime list when appropriate; it will
not become browser-readable automatically.

## Rollback and applicant-data preservation

The safest rollback is non-destructive:

1. Disable the main website redirect and public application routes.
2. Run `update public.jobs set is_public = false;`.
3. Stop new submissions and preserve/export
   `public.public_applications` plus the private bucket objects.
4. Leave the additive columns, staging rows, rate-limit table, and bucket in
   place while application code is rolled back.

If a later schema-removal migration must restore the earlier
`candidate_associations` publication or authenticated grants, reconstruct them
from the captured pre-deployment results. Do not grant or publish
`public_application_id` while the feature data remains present.

Before removing schema later, preserve the association-level
`public_application_id` provenance; removing it also removes the persistent red
row marker. Dropping `public.public_applications` destroys applicant metadata.
Deleting the private bucket destroys CVs. Delete Storage objects and the bucket
only through the Supabase Storage API or Dashboard after an approved export;
do not delete `storage.objects` rows directly.

Production migration execution remains a manual deployment step. The migration
was created and validated in the repository but was not applied to production.
