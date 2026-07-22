const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260722065251_public_open_roles_and_applications.sql'),
  'utf8'
)
const rateLimitTimestampFix = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260722091050_fix_public_application_rate_limit_timestamp.sql'),
  'utf8'
)

test('production preflight fails before DDL instead of repairing unsafe live state', () => {
  const preflight = migration.match(/do \$\$[\s\S]*?end \$\$;/i)?.[0] || ''

  assert.ok(preflight, 'expected a leading production preflight block')
  assert.ok(
    migration.indexOf(preflight) < migration.search(/alter table public\.jobs/i),
    'preflight must run before the first jobs DDL'
  )
  assert.match(migration, /set lock_timeout = '5s';\s*--[\s\S]*?\bbegin;/i)
  assert.match(migration, /\bcommit;\s*-- ROLLBACK RUNBOOK/i)

  for (const requiredRelation of [
    'public.jobs',
    'public.clients',
    'public.candidates',
    'public.candidate_associations',
    'public.page_view_permissions',
    'public.column_permissions',
    'storage.buckets',
    'auth.users'
  ]) {
    assert.match(preflight, new RegExp(requiredRelation.replace('.', '\\.'), 'i'))
  }

  assert.match(preflight, /mandate_status not in \([\s\S]*'Ongoing \(P1\)'/i)
  assert.match(preflight, /status is distinct from mandate_status/i)
  assert.match(preflight, /candidates_normalized_email_unique/i)
  assert.match(preflight, /candidates_normalized_mobile_unique/i)
  assert.match(preflight, /group by candidate_id, job_id[\s\S]*having count\(\*\) > 1/i)
  assert.match(preflight, /public\.public_applications/i)
  assert.match(preflight, /public\.public_application_rate_limits/i)
  assert.match(preflight, /information_schema\.columns/i)
  assert.match(preflight, /storage\.buckets/i)
  assert.match(preflight, /pg_policies[\s\S]*public-applications/i)
  assert.match(preflight, /server_version_num[\s\S]*150000/i)
  assert.match(preflight, /pg_publication[\s\S]*supabase_realtime/i)
  assert.match(preflight, /pg_publication_namespace[\s\S]*nspname = 'public'/i)
  assert.match(preflight, /pg_publication_tables[\s\S]*candidate_associations[\s\S]*rowfilter/i)
  assert.match(preflight, /pg_class[\s\S]*candidate_associations[\s\S]*relreplident <> 'd'/i)
  assert.doesNotMatch(preflight, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(?:table|index|column)\b/i)
})

test('Public Open Roles migration is privacy-first and depends on canonical mandate statuses', () => {
  assert.match(migration, /add column if not exists is_public boolean not null default false/i)
  assert.match(migration, /update public\.jobs\s+set is_public = false;/i)
  assert.match(migration, /20260720093624_mandate_priority_statuses\.sql/i)
  assert.match(
    migration,
    /jobs_public_eligibility_idx[\s\S]*where is_public = true[\s\S]*mandate_status = 'Ongoing \(P1\)'/i
  )
  assert.doesNotMatch(migration, /update public\.jobs[\s\S]{0,160}set public_(?:name|location|experience|jd)\s*=/i)
})

test('Public job constraints keep slugs stable and allow closed or expired listings to be retained', () => {
  assert.match(migration, /constraint jobs_public_slug_format[\s\S]*'\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/i)
  assert.match(migration, /create unique index if not exists jobs_public_slug_unique_idx[\s\S]*where public_slug is not null/i)
  assert.match(migration, /create trigger jobs_public_slug_immutable[\s\S]*before update of public_slug/i)
  assert.match(migration, /old\.public_slug is not null[\s\S]*new\.public_slug is distinct from old\.public_slug/i)

  const completeness = migration.match(
    /add constraint jobs_public_listing_complete([\s\S]*?)\) not valid;/i
  )?.[1] || ''
  assert.match(completeness, /not is_public[\s\S]*public_slug[\s\S]*public_jd/i)
  assert.doesNotMatch(completeness, /mandate_status|\bstatus\b|current_date|now\(\)/i)
})

test('staging applications enforce required identity, CV, status, and active-duplicate invariants', () => {
  assert.match(migration, /create table public\.public_applications/i)
  assert.match(migration, /public_applications_required_text_check/i)
  assert.match(migration, /email_normalized = lower\(btrim\(email\)\)/i)
  assert.match(migration, /mobile_normalized = regexp_replace\(mobile_number, '\\D', '', 'g'\)/i)
  assert.match(migration, /cv_mimetype = 'application\/pdf'/i)
  assert.match(migration, /cv_file_hash ~ '\^\[0-9a-f\]\{64\}\$'/i)
  assert.match(migration, /cv_storage_path = id::text \|\| '\/resume\.pdf'/i)
  assert.match(migration, /application_status in \('pending', 'converting', 'converted', 'linked_existing', 'rejected'\)/i)
  assert.match(migration, /converted_candidate_id uuid references public\.candidates\(id\) on delete set null/i)
  assert.match(migration, /converted_association_id uuid references public\.candidate_associations\(id\) on delete set null/i)
  assert.match(
    migration,
    /public_applications_active_job_email_unique_idx[\s\S]*application_status in \('pending', 'converting'\)/i
  )
  assert.match(
    migration,
    /public_applications_active_job_mobile_unique_idx[\s\S]*application_status in \('pending', 'converting'\)/i
  )
  assert.match(migration, /public_applications_processing_started_idx[\s\S]*application_status = 'converting'/i)
})

test('staging tables are service-role only and are not added to Realtime', () => {
  for (const table of ['public_applications', 'public_application_rate_limits']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i')
    )
    assert.match(
      migration,
      new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i')
    )
  }
  assert.doesNotMatch(migration, /create\s+policy/i)
  assert.doesNotMatch(
    migration,
    /alter\s+publication\s+supabase_realtime\s+(?:add|set)\s+table\s+public\.public_applications/i
  )
})

test('staged CV bucket is private, PDF-only, and exactly one MiB', () => {
  const bucketInsert = migration.match(/insert into storage\.buckets[\s\S]*?;\s*/i)?.[0] || ''

  assert.ok(bucketInsert, 'expected a dedicated private bucket insert')
  assert.match(
    bucketInsert,
    /'public-applications'[\s\S]*false,[\s\S]*1048576,[\s\S]*array\['application\/pdf'\]/i
  )
  assert.match(migration, /A public-applications Storage bucket already exists/i)
  assert.doesNotMatch(bucketInsert, /on conflict/i)
  assert.match(migration, /No storage\.objects policies are created/i)
})

test('conversion provenance and exact candidate-mandate uniqueness are database-backed', () => {
  assert.match(
    migration,
    /candidate_associations_public_application_id_fkey[\s\S]*references public\.public_applications\(id\)[\s\S]*on delete set null/i
  )
  assert.match(
    migration,
    /candidate_associations_public_application_unique_idx[\s\S]*where public_application_id is not null/i
  )
  assert.match(
    migration,
    /candidate_associations_candidate_job_unique_idx[\s\S]*\(candidate_id, job_id\)[\s\S]*where job_id is not null/i
  )
  assert.match(migration, /Duplicate candidate\/mandate associations must be reviewed/i)
  assert.match(migration, /attribute\.attname <> 'public_application_id'/i)
  assert.match(
    migration,
    /revoke select on table public\.candidate_associations[\s\S]*from public, anon, authenticated/i
  )
  assert.match(
    migration,
    /alter publication supabase_realtime add table public\.candidate_associations \(%s\)/i
  )
})

test('permissions are seeded without overwriting administrator choices', () => {
  assert.match(
    migration,
    /insert into public\.page_view_permissions[\s\S]*values \('applied_candidates', 'everyone'\)[\s\S]*on conflict \(page_key\) do nothing/i
  )
  assert.match(
    migration,
    /insert into public\.column_permissions[\s\S]*values \('jobs', 'public_careers_listing', 'everyone'\)[\s\S]*on conflict \(table_name, column_key\) do nothing/i
  )
})

test('durable rate limiting is atomic, hashed, and callable only by service_role', () => {
  assert.match(migration, /public_application_rate_limits_key_hash_check[\s\S]*'\^\[0-9a-f\]\{64\}\$'/i)
  assert.match(migration, /expires_at timestamptz not null/i)
  assert.match(migration, /delete from public\.public_application_rate_limits[\s\S]*expires_at <= current_time/i)
  assert.match(migration, /on conflict \(rate_key, scope\) do update/i)
  assert.match(migration, /security invoker[\s\S]*set search_path = ''/i)
  assert.match(
    migration,
    /revoke all on function public\.consume_public_application_rate_limit[\s\S]*from public, anon, authenticated/i
  )
  assert.match(
    migration,
    /grant execute on function public\.consume_public_application_rate_limit[\s\S]*to service_role/i
  )
})

test('rate-limit timestamp fix avoids the PostgreSQL CURRENT_TIME name collision', () => {
  assert.match(rateLimitTimestampFix, /request_now timestamptz := clock_timestamp\(\)/i)
  assert.match(rateLimitTimestampFix, /expires_at <= request_now/i)
  assert.doesNotMatch(rateLimitTimestampFix, /\bcurrent_time\s+timestamptz/i)
  assert.match(
    rateLimitTimestampFix,
    /grant execute on function public\.consume_public_application_rate_limit[\s\S]*to service_role/i
  )
})

test('migration has balanced dollar-quoted function blocks', () => {
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0)
})
