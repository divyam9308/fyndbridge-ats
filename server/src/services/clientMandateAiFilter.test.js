const test = require('node:test')
const assert = require('node:assert/strict')
const { clientAiFilter } = require('./clientAiFilter')
const { mandateAiFilter } = require('./mandateAiFilter')

const validate = (filter, root, options) => filter.validateFilter({ root }, options).root
const leaf = (field, operator, value) => ({ type: 'condition', field, operator, ...(value !== undefined ? { value } : {}) })

test('Client numeric value is absolute INR and is never compared to terms_value text', () => {
  const root = validate(clientAiFilter, leaf('value', 'greater_than', '₹10,00,000'))
  assert.equal(root.value, 1000000)
  const compiled = clientAiFilter.compileAst(root)
  assert.equal(compiled, 'ai_terms_value_amount.gt."1000000"')
  assert.doesNotMatch(compiled, /terms_value\./)
})

test('Client any-follow-up dates use the related-table multirange and empty count', () => {
  const between = validate(clientAiFilter, leaf('follow_up_date', 'between', ['2026-07-15', '2026-07-22']))
  assert.equal(clientAiFilter.compileAst(between), 'ai_follow_up_ranges.ov."[2026-07-15,2026-07-22]"')
  const empty = validate(clientAiFilter, leaf('follow_up_date', 'is_empty'))
  assert.equal(clientAiFilter.compileAst(empty), 'ai_follow_up_count.eq.0')
})

test('Client contract document availability requires any populated path and all paths empty for missing', () => {
  const present = clientAiFilter.compileAst(validate(clientAiFilter, leaf('contract_document', 'is_not_empty')))
  const missing = clientAiFilter.compileAst(validate(clientAiFilter, leaf('contract_document', 'is_empty')))
  assert.match(present, /^or\(/)
  assert.match(missing, /^and\(/)
  for (const column of ['contract_document', 'contract_pdf_url', 'contract_pdf_storage_path']) {
    assert.match(present, new RegExp(column))
    assert.match(missing, new RegExp(column))
  }
})

test('Mandate exact consultant membership avoids substring false positives', () => {
  const root = validate(mandateAiFilter, leaf('consultant', 'contains', 'Cherry'))
  const compiled = mandateAiFilter.compileAst(root)
  assert.match(compiled, /ai_consultants_normalized\.cs\./)
  assert.doesNotMatch(compiled, /ilike/)
})

test('Mandate missing JD requires both path aliases to be empty', () => {
  const compiled = mandateAiFilter.compileAst(validate(mandateAiFilter, leaf('jd', 'is_empty')))
  assert.match(compiled, /^and\(/)
  assert.match(compiled, /jd_storage_path/)
  assert.match(compiled, /jd_url/)
})

test('nested OR plus AND remains recursive through compilation', () => {
  const root = validate(mandateAiFilter, {
    type: 'group', combinator: 'AND', children: [
      { type: 'group', combinator: 'OR', children: [leaf('location', 'contains', 'Delhi'), leaf('location', 'contains', 'Gurgaon')] },
      leaf('budget', 'greater_than', '15 lpa')
    ]
  })
  const compiled = mandateAiFilter.compileAst(root)
  assert.match(compiled, /^and\(or\(/)
  assert.match(compiled, /ai_budget_ceiling_lpa\.gt\."15"/)
})
