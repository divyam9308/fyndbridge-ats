const FIELD_LABELS = {
  candidate_name: 'Name', organisation: 'Current employer', designation: 'Current designation',
  consultant: 'Consultant', current_location: 'Location', current_ctc: 'Current CTC',
  expected_ctc: 'Expected CTC', offered_ctc: 'Offered CTC', notice_period: 'Notice period',
  open_to_relocate: 'Willing to relocate', cv: 'CV', jd: 'JD attachment',
  client_name: 'Hiring client', role: 'Mandate role', date_of_allocation: 'Allocated',
  terms_signed: 'Commercial terms accepted', contract_signed: 'Contract signed',
  contract_document: 'Contract attachment', value: 'Client value',
  follow_up_date: 'Any follow-up date', next_follow_up_date: 'Next follow-up date'
}

const OPERATORS = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'excludes',
  greater_than: '>', greater_than_or_equal: '≥', less_than: '<', less_than_or_equal: '≤',
  in: 'is any of', not_in: 'excludes all of', contains_all: 'includes all of', contains_any: 'includes any of',
  is_empty: 'is missing', is_not_empty: 'is present', is_null: 'is missing', is_not_null: 'is present',
  between: 'between', on_or_before: 'on or before', on_or_after: 'on or after'
}

function fieldLabel(field, entity) {
  if (field === 'client_name' && entity === 'clients') return 'Client name'
  return FIELD_LABELS[field] || String(field || '').replace(/_/g, ' ')
}

function valueLabel(value, field) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    if (['current_ctc', 'expected_ctc', 'offered_ctc', 'value'].includes(field)) return `₹${value.toLocaleString('en-IN')}`
    if (field === 'budget') return `${value} LPA`
    if (field === 'experience') return `${value} years`
    if (field === 'notice_period') return `${value} days`
  }
  return String(value ?? '')
}

function describeNode(node, entity) {
  const children = node.children || node.filters
  if (Array.isArray(children)) {
    const logic = node.combinator || node.logic || 'and'
    return `(${children.map(child => describeNode(child, entity)).join(` ${logic.toUpperCase()} `)})`
  }
  const values = Array.isArray(node.value)
    ? node.value.map(value => valueLabel(value, node.field)).join(node.operator === 'between' ? ' and ' : ', ')
    : valueLabel(node.value, node.field)
  return `${fieldLabel(node.field, entity)} ${OPERATORS[node.operator] || String(node.operator).replace(/_/g, ' ')}${values ? ` ${values}` : ''}`
}

export default function SearchInterpretation({ filters, notice, entity }) {
  if (!filters) return null
  const descriptions = []
  if (filters.root) descriptions.push(describeNode(filters.root, entity))
  else if (filters.filters?.length) descriptions.push(describeNode(filters, entity))
  if (filters.search_text) descriptions.push(`Text matches: “${filters.search_text}”`)
  if (filters.sort?.length) descriptions.push(`Sort: ${filters.sort.map(sort => `${fieldLabel(sort.field, entity)} ${sort.direction === 'desc' ? 'descending' : 'ascending'}`).join(', ')}`)
  return (
    <div role="status" aria-live="polite" style={{ marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
      {notice && <div>{notice}</div>}
      <div><strong>Applied search:</strong> {descriptions.join(' AND ')}</div>
      {entity === 'mandates' && filters.conditions?.some(node => ['budget', 'experience'].includes(node.field)) && (
        <div>Budget and experience match overlapping stored ranges.</div>
      )}
    </div>
  )
}
