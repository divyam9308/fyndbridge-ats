const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

process.env.SUPABASE_URL ||= 'https://unit-test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-service-role-key'

const {
  claimApplication,
  countActiveApplications,
  finalizeApplication,
  recordConversionCandidate,
  rejectApplication,
  removeFinalizedApplication,
  releaseApplicationClaim
} = require('./appliedCandidates')
const {
  conversionBlankFillPermissionPayload,
  conversionPayload,
  conversionRequestPermissionPayload,
  insertAssociation,
  removeCandidateIfUnassociated,
  validateCandidatePayload
} = require('./candidateCreation')

const root = path.resolve(__dirname, '../../..')
const appliedController = fs.readFileSync(path.join(root, 'server/src/controllers/appliedCandidatesController.js'), 'utf8')
const candidateController = fs.readFileSync(path.join(root, 'server/src/controllers/candidateController.js'), 'utf8')
const candidatePage = fs.readFileSync(path.join(root, 'src/pages/CandidatesPage.jsx'), 'utf8')
const sharedCss = fs.readFileSync(path.join(root, 'src/styles/Shared.css'), 'utf8')
const durableSourceMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260722201214_persist_public_application_candidate_source.sql'), 'utf8')
const associationOriginMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260722202739_persist_applied_candidate_association_origin.sql'), 'utf8')
const candidateUtils = fs.readFileSync(path.join(root, 'src/utils/candidateUtils.js'), 'utf8')
const clientDetailPage = fs.readFileSync(path.join(root, 'src/pages/ClientDetailPage.jsx'), 'utf8')

function application(overrides = {}) {
  return {
    id: 'application-1',
    job_id: 'job-1',
    client_id: 'client-1',
    application_status: 'pending',
    processing_token: null,
    processing_started_at: null,
    converted_candidate_id: null,
    converted_association_id: null,
    ...overrides
  }
}

function memorySupabase(initial, { raceToConverted = false } = {}) {
  let row = { ...initial }
  const operations = []

  function from(table) {
    assert.equal(table, 'public_applications')
    const state = { update: null, filters: [], comparisons: [], returning: false }
    const builder = {
      select() { state.returning = true; return builder },
      update(values) { state.update = values; return builder },
      eq(field, value) { state.filters.push([field, value]); return builder },
      lt(field, value) { state.comparisons.push([field, value]); return builder },
      async maybeSingle() {
        operations.push({
          type: state.update ? 'update' : 'select',
          update: state.update && { ...state.update },
          filters: [...state.filters],
          comparisons: [...state.comparisons]
        })
        const matches = state.filters.every(([field, value]) => row?.[field] === value) &&
          state.comparisons.every(([field, value]) => row?.[field] < value)
        if (!state.update) return { data: matches ? { ...row } : null, error: null }
        if (!matches) return { data: null, error: null }
        if (raceToConverted) {
          row = {
            ...row,
            application_status: 'converted',
            converted_candidate_id: 'candidate-race',
            converted_association_id: 'association-race'
          }
          return { data: null, error: null }
        }
        row = { ...row, ...state.update }
        return { data: { ...row }, error: null }
      },
      then(resolve, reject) { return builder.maybeSingle().then(resolve, reject) }
    }
    return builder
  }

  return { from, operations, getRow: () => ({ ...row }) }
}

test('pending conversion uses a conditional claim and finalizes only with its processing token', async () => {
  const now = new Date('2026-07-22T06:30:00.000Z')
  const supabase = memorySupabase(application())
  const claim = await claimApplication(supabase, 'application-1', now)

  assert.equal(claim.idempotent, false)
  assert.match(claim.token, /^[0-9a-f-]{36}$/)
  assert.equal(claim.application.application_status, 'converting')
  const claimUpdate = supabase.operations.find((operation) => operation.type === 'update')
  assert.ok(claimUpdate.filters.some(([field, value]) => field === 'id' && value === 'application-1'))
  assert.ok(claimUpdate.filters.some(([field, value]) => field === 'application_status' && value === 'pending'))

  const finalized = await finalizeApplication(supabase, 'application-1', claim.token, {
    application_status: 'converted',
    candidate_id: 'candidate-1',
    association_id: 'association-1',
    user_id: 'user-1'
  })
  assert.equal(finalized.application_status, 'converted')
  assert.equal(finalized.converted_candidate_id, 'candidate-1')
  const finalizeUpdate = supabase.operations.filter((operation) => operation.type === 'update').at(-1)
  assert.ok(finalizeUpdate.filters.some(([field, value]) => field === 'processing_token' && value === claim.token))
})

test('Applied Candidates badge counts only active rows with an exact head count', async () => {
  const calls = []
  const builder = {
    select(columns, options) { calls.push(['select', columns, options]); return this },
    in(column, values) { calls.push(['in', column, values]); return this },
    then(resolve) { return Promise.resolve({ count: 3, error: null }).then(resolve) }
  }
  const count = await countActiveApplications({ from: table => { assert.equal(table, 'public_applications'); return builder } })
  assert.equal(count, 3)
  assert.deepEqual(calls, [
    ['select', 'id', { count: 'exact', head: true }],
    ['in', 'application_status', ['pending', 'converting']]
  ])
})

test('already-converted applications are idempotent and a lost claim race reconciles to the durable result', async () => {
  const converted = memorySupabase(application({
    application_status: 'converted',
    converted_candidate_id: 'candidate-1',
    converted_association_id: 'association-1'
  }))
  const existing = await claimApplication(converted, 'application-1')
  assert.equal(existing.idempotent, true)
  assert.equal(existing.token, null)
  assert.equal(converted.operations.some((operation) => operation.type === 'update'), false)

  const raced = memorySupabase(application(), { raceToConverted: true })
  const reconciled = await claimApplication(raced, 'application-1')
  assert.equal(reconciled.idempotent, true)
  assert.equal(reconciled.token, null)
  assert.equal(reconciled.application.converted_candidate_id, 'candidate-race')
})

test('finalized conversion removes the applied row and its staged CV', async () => {
  let rowExists = true
  const removedPaths = []
  const supabase = {
    from(table) {
      assert.equal(table, 'public_applications')
      const builder = {
        delete() { return builder },
        eq() { return builder },
        in() { return builder },
        select() { return builder },
        async maybeSingle() {
          if (!rowExists) return { data: null, error: null }
          rowExists = false
          return { data: { id: 'application-1' }, error: null }
        }
      }
      return builder
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'public-applications')
        return {
          async remove(paths) {
            removedPaths.push(...paths)
            return { data: paths, error: null }
          }
        }
      }
    }
  }

  const result = await removeFinalizedApplication(supabase, application({
    application_status: 'converted',
    converted_candidate_id: 'candidate-1',
    converted_association_id: 'association-1',
    cv_storage_path: 'application-1/resume.pdf'
  }))

  assert.deepEqual(result, { removed: true, cvRemoved: true })
  assert.equal(rowExists, false)
  assert.deepEqual(removedPaths, ['application-1/resume.pdf'])
})

test('rejection needs no reason and removes both the staged CV and the applied-candidate row', async () => {
  let row = application({ cv_storage_path: 'application-1/resume.pdf' })
  const removedPaths = []
  const supabase = {
    from(table) {
      assert.equal(table, 'public_applications')
      const state = { update: null, deleting: false, filters: [] }
      const builder = {
        select() { return builder },
        update(values) { state.update = values; return builder },
        delete() { state.deleting = true; return builder },
        eq(field, value) { state.filters.push([field, value]); return builder },
        async maybeSingle() {
          const matches = state.filters.every(([field, value]) => row?.[field] === value)
          if (!matches) return { data: null, error: null }
          if (state.deleting) {
            const removed = row
            row = null
            return { data: { id: removed.id }, error: null }
          }
          if (state.update) row = { ...row, ...state.update }
          return { data: row ? { ...row } : null, error: null }
        }
      }
      return builder
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'public-applications')
        return {
          async remove(paths) {
            removedPaths.push(...paths)
            return { data: paths, error: null }
          }
        }
      }
    }
  }

  const rejected = await rejectApplication(supabase, 'application-1', 'user-1', '')
  assert.equal(rejected.application_status, 'rejected')
  assert.equal(rejected.rejection_reason, null)
  assert.equal(row, null)
  assert.deepEqual(removedPaths, ['application-1/resume.pdf'])
})

test('applied conversion allows a blank Expected CTC but still validates a supplied value', () => {
  const payload = {
    full_name: 'Staged Candidate',
    email: 'staged@example.com',
    mobile_number: '+919876543210',
    experience_years: 8,
    notice_period: 30,
    open_to_relocate: 'true',
    skills: ['Analysis'],
    current_salary: 20,
    expected_salary: null,
    status: 'In Discussion'
  }
  assert.equal(validateCandidatePayload(payload, { requireExpectedSalary: false }).expected_salary, undefined)
  assert.equal(
    validateCandidatePayload({ ...payload, expected_salary: '18.5' }, { requireExpectedSalary: false }).expected_salary,
    'expected_salary must be a positive integer with at most 9 digits'
  )
  assert.equal(validateCandidatePayload(payload).expected_salary, 'expected_salary must be a positive integer with at most 9 digits')
})

test('active conversions reject a second worker, while stale claims are reclaimed conditionally', async () => {
  const now = new Date('2026-07-22T06:30:00.000Z')
  const active = memorySupabase(application({
    application_status: 'converting',
    processing_token: 'active-token',
    processing_started_at: '2026-07-22T06:20:00.000Z'
  }))
  await assert.rejects(claimApplication(active, 'application-1', now), { statusCode: 409 })

  const stale = memorySupabase(application({
    application_status: 'converting',
    processing_token: 'stale-token',
    processing_started_at: '2026-07-22T06:14:59.000Z'
  }))
  const reclaimed = await claimApplication(stale, 'application-1', now)
  assert.equal(reclaimed.idempotent, false)
  assert.notEqual(reclaimed.token, 'stale-token')
  const update = stale.operations.find((operation) => operation.type === 'update')
  assert.ok(update.filters.some(([field, value]) => field === 'processing_token' && value === 'stale-token'))
  assert.ok(update.comparisons.some(([field]) => field === 'processing_started_at'))
})

test('claim release is token-bound and cannot release another converter claim', async () => {
  const claimed = memorySupabase(application({
    application_status: 'converting',
    processing_token: 'correct-token',
    processing_started_at: '2026-07-22T06:30:00.000Z'
  }))
  await releaseApplicationClaim(claimed, 'application-1', 'wrong-token')
  assert.equal(claimed.getRow().application_status, 'converting')
  assert.equal(claimed.getRow().processing_token, 'correct-token')

  await releaseApplicationClaim(claimed, 'application-1', 'correct-token')
  assert.equal(claimed.getRow().application_status, 'pending')
  assert.equal(claimed.getRow().processing_token, null)
  assert.equal(claimed.getRow().converted_candidate_id, null)
})

test('a claimed conversion durably records its provisional candidate for stale retry', async () => {
  const claimed = memorySupabase(application({
    application_status: 'converting',
    processing_token: 'correct-token',
    processing_started_at: '2026-07-22T06:30:00.000Z'
  }))
  const recorded = await recordConversionCandidate(claimed, 'application-1', 'correct-token', 'candidate-provisional')
  assert.equal(recorded.converted_candidate_id, 'candidate-provisional')
  assert.equal(claimed.getRow().application_status, 'converting')

  await assert.rejects(
    recordConversionCandidate(claimed, 'application-1', 'wrong-token', 'candidate-other'),
    { statusCode: 409 }
  )
  assert.equal(claimed.getRow().converted_candidate_id, 'candidate-provisional')
})

test('association insertion keeps provenance only when explicitly provided and fails if marker persistence is unavailable', async () => {
  const inserted = []
  const supabase = {
    from(table) {
      assert.equal(table, 'candidate_associations')
      return {
        insert(payload) {
          inserted.push(payload)
          return {
            select() {
              return { single: async () => ({ data: { id: 'association-1', ...payload }, error: null }) }
            }
          }
        }
      }
    }
  }

  const marked = await insertAssociation(supabase, {
    candidate_id: 'candidate-1',
    job_id: 'job-1',
    status: 'Interested',
    public_application_id: 'application-1',
    from_applied_candidates: true
  }, { requirePublicMarker: true })
  assert.equal(marked.error, null)
  assert.equal(inserted[0].public_application_id, 'application-1')
  assert.equal(inserted[0].from_applied_candidates, true)

  await insertAssociation(supabase, {
    candidate_id: 'candidate-2',
    job_id: 'job-1',
    status: 'Interested'
  })
  assert.equal(Object.hasOwn(inserted[1], 'public_application_id'), false)

  const missingMarkerColumn = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () => ({
                  data: null,
                  error: { code: 'PGRST204', message: "Could not find the 'public_application_id' column" }
                })
              }
            }
          }
        }
      }
    }
  }
  const unavailable = await insertAssociation(missingMarkerColumn, {
    candidate_id: 'candidate-1',
    job_id: 'job-1',
    status: 'Interested',
    public_application_id: 'application-1'
  }, { requirePublicMarker: true })
  assert.equal(unavailable.error.statusCode, 503)
})

test('conversion permission checks include only explicit edits and explicit blank-fill requests', () => {
  const explicit = conversionRequestPermissionPayload({
    full_name: 'Reviewed Name',
    current_salary: 24,
    consultant_user_id: 'user-1',
    confirm_closed_role: true,
    action: 'create',
    client_id: 'attacker-supplied-client'
  })
  assert.deepEqual(explicit, {
    full_name: 'Reviewed Name',
    consultant_user_id: 'user-1',
    current_salary: 24
  })

  assert.deepEqual(conversionRequestPermissionPayload({ action: 'create' }), {})
  assert.deepEqual(conversionBlankFillPermissionPayload(new Set(['email', 'current_company', 'cv'])), {
    email: true,
    current_company: true,
    cv_files: true
  })
})

test('conversion preserves mandatory staged values when protected fields are omitted from the request', () => {
  const application = {
    client_id: 'client-1',
    job_id: 'job-1',
    client_name_snapshot: 'Client One',
    internal_job_title_snapshot: 'Internal Role',
    full_name: 'Staged Name',
    email: 'staged@example.com',
    mobile_number: '+919876543210',
    current_designation: 'Manager',
    current_organisation: 'Existing Org',
    experience_years: 8,
    location: 'Mumbai',
    skills: ['Analysis'],
    notice_period: 30,
    open_to_relocate: true,
    linkedin_url: 'https://www.linkedin.com/in/staged',
    current_salary: 20,
    expected_salary: 25,
    comments: 'Staged comment'
  }
  const result = conversionPayload(application, { status: 'In Discussion' })

  assert.equal(result.candidate.full_name, application.full_name)
  assert.equal(result.candidate.email, application.email)
  assert.equal(result.candidate.current_organisation, application.current_organisation)
  assert.deepEqual(result.candidate.skills, application.skills)
  assert.equal(result.association.current_salary, application.current_salary)
  assert.equal(result.association.expected_salary, application.expected_salary)
  assert.equal(result.association.notes, application.comments)
  assert.equal(result.association.status, 'In Discussion')
})

function cleanupSupabase({ associationCount = 0, associationError = null, deleteError = null, deleteRemoves = true } = {}) {
  let candidateExists = true
  let deleteCalls = 0
  return {
    from(table) {
      if (table === 'candidate_associations') {
        return {
          select() { return this },
          eq: async () => ({ count: associationCount, error: associationError })
        }
      }
      assert.equal(table, 'candidates')
      return {
        delete() {
          return {
            eq: async () => {
              deleteCalls += 1
              if (!deleteError && deleteRemoves) candidateExists = false
              return { error: deleteError }
            }
          }
        },
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: candidateExists ? { id: 'candidate-1' } : null, error: null } }
      }
    },
    getCandidateExists: () => candidateExists,
    getDeleteCalls: () => deleteCalls
  }
}

test('inserted-candidate cleanup verifies deletion and preserves candidates that gained an association', async () => {
  const removable = cleanupSupabase()
  assert.equal(await removeCandidateIfUnassociated(removable, 'candidate-1'), true)
  assert.equal(removable.getCandidateExists(), false)
  assert.equal(removable.getDeleteCalls(), 1)

  const associated = cleanupSupabase({ associationCount: 1 })
  assert.equal(await removeCandidateIfUnassociated(associated, 'candidate-1'), false)
  assert.equal(associated.getCandidateExists(), true)
  assert.equal(associated.getDeleteCalls(), 0)
})

test('unconfirmed candidate cleanup is a recoverable error that preserves the conversion claim', async () => {
  const failedDelete = cleanupSupabase({ deleteRemoves: false })
  await assert.rejects(
    removeCandidateIfUnassociated(failedDelete, 'candidate-1'),
    error => error.statusCode === 500 && error.preserveClaim === true && /remains in processing state/.test(error.message)
  )
})

test('controller contract marks only newly created candidates and reconciles durable markers before creating', () => {
  const linkStart = appliedController.indexOf("if (action === 'link_existing')")
  const createStart = appliedController.indexOf('if (duplicates.length)', linkStart)
  const linkBlock = appliedController.slice(linkStart, createStart)
  const createBlock = appliedController.slice(createStart, appliedController.indexOf('} catch (error)', createStart))

  assert.ok(linkStart >= 0 && createStart > linkStart)
  assert.doesNotMatch(linkBlock, /public_application_id/)
  assert.match(linkBlock, /if \(!association\)[\s\S]*from_applied_candidates:\s*true/)
  assert.match(createBlock, /public_application_id:\s*application\.id/)
  assert.match(createBlock, /from_applied_candidates:\s*true/)
  assert.match(createBlock, /requirePublicMarker:\s*true/)
  assert.match(createBlock, /removeCandidateIfUnassociated\(supabase, candidate\.id\)/)
  assert.ok(appliedController.indexOf('recordConversionCandidate(supabase, application.id, claim.token, candidate.id)') < appliedController.indexOf('public_application_id: application.id'))
  assert.match(appliedController, /if \(application\.converted_candidate_id\)[\s\S]*candidate = await findCandidateById\(provisionalCandidateId\)/)
  assert.match(appliedController, /catch \(candidateCleanupFailure\)[\s\S]*recordConversionCandidate\(supabase, claim\.application\.id, claim\.token, insertedCandidateId\)/)
  assert.ok(appliedController.indexOf('findAssociationByMarker(application.id)') < linkStart)
  assert.match(appliedController, /claim\?\.token\s*&&\s*!cleanupFailure[\s\S]*!error\.preserveClaim/)
  assert.ok((appliedController.match(/removeFinalizedApplication\(supabase,/g) || []).length >= 5)

  assert.match(candidateController, /is_public_application_conversion:\s*Boolean\(row\.from_applied_candidates\)/)
  assert.match(candidateController, /is_public_application_conversion:\s*false/)
  assert.doesNotMatch(candidateController, /public_application_id:\s*row\.public_application_id/)
})

test('conversion provenance survives staging cleanup and repairs the reported CA844 row', () => {
  const payload = conversionPayload(application(), {})
  assert.equal(payload.candidate.source, 'public_application')
  assert.match(durableSourceMigration, /association\.public_application_id is not null/)
  assert.match(durableSourceMigration, /candidate\.candidate_display_id[\s\S]*CA844/i)
  assert.match(durableSourceMigration, /association\.consultant_name[\s\S]*prasobh krishnan/i)
})

test('red-dot provenance is association-specific in main Candidates and Client Details', () => {
  assert.match(associationOriginMigration, /add column if not exists from_applied_candidates boolean not null default false/)
  assert.match(associationOriginMigration, /candidate\.candidate_display_id[\s\S]*CA844/i)
  assert.match(associationOriginMigration, /association\.consultant_name[\s\S]*prasobh krishnan/i)
  assert.match(candidateUtils, /isPublicApplicationConversion:\s*Boolean\(row\.is_public_application_conversion\)/)
  assert.match(clientDetailPage, /candidate-public-source-dot/)
  assert.match(clientDetailPage, /title="From Applied Candidates"/)
})

test('main candidates table shows the public-application marker as a dot beside Candidate ID', () => {
  assert.match(candidatePage, /candidate-display-id-value/)
  assert.match(candidatePage, /candidate-public-source-dot/)
  assert.match(candidatePage, /title="From Applied Candidates"/)
  assert.match(sharedCss, /\.candidate-public-source-dot\s*\{[\s\S]*width:\s*7px;[\s\S]*border-radius:\s*50%;[\s\S]*background:\s*#dc3545;/)
  assert.doesNotMatch(sharedCss, /candidate-public-application-row/)
})
