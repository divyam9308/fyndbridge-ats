const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const clients = fs.readFileSync(path.join(root, 'src/pages/ClientsPage.jsx'), 'utf8')
const mandates = fs.readFileSync(path.join(root, 'src/pages/JobsPage.jsx'), 'utf8')

test('Client and Mandate page requests retain canonical intents across page, size and sort requests', () => {
  for (const source of [clients, mandates]) {
    assert.match(source, /params\.set\('page', String\(page\)\)/)
    assert.match(source, /params\.set\('limit', String\(pageSize\)\)/)
    assert.match(source, /params\.set\('ai_filters', JSON\.stringify\(aiFilters\)\)/)
    assert.match(source, /params\.set\('sortField', sortField\)/)
    assert.match(source, /onPageSizeChange=\{\(value\) => \{ setPageSize\(value\); setPage\(1\) \}\}/)
  }
})

test('clearing and editing invalidate pending AI calls without installing browser-generated fallback filters', () => {
  for (const source of [clients, mandates]) {
    assert.match(source, /aiFilterRequestRef\.current \+= 1/)
    assert.match(source, /aiFilterAbortRef\.current\?\.abort\(\)/)
    assert.match(source, /setAiFilters\(null\)/)
    assert.match(source, /setPage\(1\)/)
    assert.doesNotMatch(source, /keywordFilters\(/)
  }
})

test('stale list results cannot overwrite new results and a failed request preserves existing rows', () => {
  assert.match(clients, /requestId !== clientListRequestRef\.current \|\| controller\.signal\.aborted/)
  assert.match(mandates, /requestId !== mandateListRequestRef\.current \|\| controller\.signal\.aborted/)
  for (const source of [clients, mandates]) {
    assert.doesNotMatch(source, /catch \(err\)[\s\S]{0,300}set(?:Clients|Jobs)\(\[\]\)/)
    assert.match(source, /Previous (?:client|mandate) results are still shown/)
  }
})

test('zero filtered results show both a red alert and a full-width message inside the existing table', () => {
  assert.match(clients, /No clients match your filters/)
  assert.match(mandates, /No mandates match your filters/)
  for (const source of [clients, mandates]) {
    assert.match(source, /className="table-empty-row"/)
    assert.match(source, /colSpan=\{Math\.max\(activeColumns\.length, 1\)\}/)
    assert.match(source, /className="form-error"[\s\S]*role="alert"/)
  }
})
