const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../../../src/pages/CandidatesPage.jsx'), 'utf8')

function between(startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start + startText.length)
  assert.ok(start >= 0 && end > start, `expected ${startText} before ${endText}`)
  return source.slice(start, end)
}

test('pagination retention: page and page-size requests keep the applied validated AI contract', () => {
  const load = between('const loadCandidates = useCallback', 'const openDocument = useCallback')
  assert.match(load, /page:\s*String\(nextPage\)/)
  assert.match(load, /limit:\s*String\(pageSize\)/)
  assert.match(load, /if \(aiFilters\)\s*\{[\s\S]*params\.set\('ai_filters', JSON\.stringify\(aiFilters\)\)/)
  assert.doesNotMatch(load, /ai_prompt/)
  assert.match(load, /\[aiFilters, dashboardFilters, filterJob, page, pageSize, sortDirection, sortField\]/)
  assert.match(source, /onPageChange=\{setPage\}/)
  assert.match(source, /onPageSizeChange=\{\(value\) => \{ setPageSize\(value\); setPage\(1\) \}\}/)
})

test('clearing filter invalidates pending AI work and restores the unfiltered first page', () => {
  const clear = between('const clearFilters = () =>', 'const togglePendingColumn')
  assert.match(clear, /aiFilterRequestRef\.current \+= 1/)
  assert.match(clear, /setAiFilterLoading\(false\)/)
  assert.match(clear, /setAiFilterText\(''\)/)
  assert.match(clear, /setAiFilters\(null\)/)
  assert.match(clear, /setAiFilterError\(''\)/)
  assert.match(clear, /setPage\(1\)/)
})

test('stale or failed candidate requests cannot erase a newer successful result set', () => {
  const load = between('const loadCandidates = useCallback', 'const openDocument = useCallback')
  assert.match(load, /candidateListAbortRef\.current\?\.abort\(\)/)
  assert.match(load, /requestId !== candidateListRequestRef\.current \|\| controller\.signal\.aborted/)
  assert.doesNotMatch(load, /setCandidates\(\[\]\)/)
  assert.doesNotMatch(load, /setTotalCandidates\(0\)/)
})

test('an empty candidate result keeps the table visible and shows a full-width message row', () => {
  const emptyBranch = between(') : filtered.length === 0 ? (', ') : (')
  assert.match(emptyBranch, /<table[\s\S]*aria-label="Candidates"/)
  assert.match(emptyBranch, /<thead>[\s\S]*activeColumns\.map/)
  assert.match(emptyBranch, /<tbody>[\s\S]*className="table-empty-row"/)
  assert.match(emptyBranch, /colSpan=\{Math\.max\(activeColumns\.length, 1\)\}/)
  assert.match(emptyBranch, /No candidates match your filters/)
  assert.match(emptyBranch, /No candidates found/)
})
