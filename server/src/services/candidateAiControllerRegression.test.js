const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/candidateController.js'), 'utf8')
const provider = fs.readFileSync(path.join(root, 'server/src/services/aiProvider.js'), 'utf8')
const evaluator = fs.readFileSync(path.join(root, 'server/scripts/evaluate-candidate-ai-filter.js'), 'utf8')

function functionSource(name, nextName) {
  const start = controller.indexOf(`function ${name}`)
  const asyncStart = controller.indexOf(`async function ${name}`)
  const actualStart = start >= 0 && (asyncStart < 0 || start < asyncStart) ? start : asyncStart
  const nextStart = controller.indexOf(`function ${nextName}`, actualStart + 1)
  const nextAsyncStart = controller.indexOf(`async function ${nextName}`, actualStart + 1)
  const end = nextStart >= 0 && (nextAsyncStart < 0 || nextStart < nextAsyncStart) ? nextStart : nextAsyncStart
  assert.ok(actualStart >= 0 && end > actualStart)
  return controller.slice(actualStart, end)
}

test('candidate list revalidates persisted v2 intent and recomputes an executable safe root', () => {
  const source = functionSource('listCandidates', 'listCandidateAssociations')
  assert.match(source, /validatePersistedCandidateFilters\(rawAiFilters, allowedFields\)/)
  assert.match(source, /candidateExecutionFilter\(validated, allowedFields\)/)
  assert.match(source, /resolveCandidateFilterReferences/)
  assert.match(source, /createCandidateAstQueryPlan\(supabase, aiFilters\.root, \{ forceAssociationRows:/)
})

test('candidate association filters and count are applied before server-side range pagination', () => {
  const source = functionSource('listCandidates', 'listCandidateAssociations')
  const associationBranch = source.slice(source.indexOf('if (aiAssociationRows)'), source.indexOf("let relationSelect = 'candidate_associations(*)'"))
  assert.match(associationBranch, /select\(aiPlan\.select, \{ count: 'exact' \}\)/)
  assert.match(associationBranch, /order\('candidates\(full_name\)'/)
  assert.ok(associationBranch.indexOf('applyCandidateAstPlan') < associationBranch.indexOf('query.range(from, to)'))
  assert.ok(associationBranch.indexOf('query.range(from, to)') < associationBranch.indexOf('await query'))
  assert.match(associationBranch, /\(data \|\| \[\]\)\.map\(flattenAssociation\)/)
  assert.match(source, /forceAssociationRows: Boolean\(hasAssocFilters\)/)
  assert.match(source, /applyCandidateBaseListFilters\(query, req, allowedFields, 'candidates'\)/)
  assert.match(controller, /function applyCandidateBaseListFilters[\s\S]*?buildSafeCandidateSearchRoot\(cleanText\(req\.query\.search\), allowedFields\)[\s\S]*?compileCandidateAst\(searchRoot\)/)
  assert.doesNotMatch(associationBranch, /full_name\.ilike\.%\$\{search\}/)
})

test('cross-domain OR merges bounded association and candidate-only rows before server-side paging', () => {
  const source = functionSource('listCandidates', 'listCandidateAssociations')
  const mixedBranch = source.slice(source.indexOf('if (aiMixedRows)'), source.indexOf('if (aiAssociationRows)'))
  assert.match(mixedBranch, /aiPlan\.associationIds/)
  assert.match(mixedBranch, /aiPlan\.candidateOnlyIds/)
  assert.match(mixedBranch, /completeBoundedRows\(associationResult\)\.map\(flattenAssociation\)/)
  assert.match(mixedBranch, /completeBoundedRows\(candidateResult\)\.map\(flattenCandidateOnly\)/)
  assert.ok(mixedBranch.indexOf('applyCandidateBaseListFilters') < mixedBranch.indexOf('sorted.slice(from, to + 1)'))
  assert.match(mixedBranch, /const total = sorted\.length/)
})

test('AI fields inherit the existing hidden-column permission groups', () => {
  assert.match(controller, /offered_ctc:\s*'current_salary'/)
  assert.match(controller, /date_of_joining:\s*'created_at'/)
  assert.match(controller, /updated_date:\s*'created_at'/)
})

test('candidate POST validates keyword executability and consultant references without returning internal SQL', () => {
  const source = functionSource('buildAiCandidateFilters', 'storagePathFromResumeUrl')
  assert.match(source, /parseAiFilters\('candidates', prompt, \{ allowedFields \}\)/)
  assert.match(source, /resolveCandidateFilterReferences\(candidateExecutionFilter\(result\.filters, allowedFields\)\)/)
  assert.match(source, /return res\.json\(result\)/)
  assert.doesNotMatch(source, /select \*|PostgREST|\.rpc\(/i)
})

test('candidate provider primaryOnly path cannot call secondary or retry primary', () => {
  const start = provider.indexOf('if (primaryOnly)')
  const end = provider.indexOf('if (!isQuotaError(err))', start)
  assert.ok(start >= 0 && end > start)
  const primaryOnly = provider.slice(start, end)
  assert.doesNotMatch(primaryOnly, /SECONDARY|requestProvider\(/)
  assert.match(primaryOnly, /throw quotaReachedError\(\)/)
  assert.match(primaryOnly, /throw normalized/)
})

test('manual live evaluator is opt-in and also uses the v2 one-call contract', () => {
  assert.match(evaluator, /ALLOW_LIVE_CANDIDATE_AI_EVALUATION/)
  assert.match(evaluator, /buildCandidateIntentPrompt/)
  assert.match(evaluator, /candidateIntentSchema/)
  assert.match(evaluator, /primaryOnly:\s*true/)
})
