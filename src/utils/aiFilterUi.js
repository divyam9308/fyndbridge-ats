import React from 'react'

export const normalizeSearchText = (value) => String(value || '')
  .toLowerCase()
  .replace(/\breactjs\b/g, 'react')
  .replace(/\bnodejs\b/g, 'node')
  .replace(/\bjs\b/g, 'javascript')
  .replace(/\bml\b/g, 'machine learning')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const isSimpleKeywordSearch = (page, prompt) => {
  const text = normalizeSearchText(prompt)
  if (!text) return false
  if (/\b(ca|cl|jb)\s*\d+\b/i.test(prompt)) return false
  const structured = {
    clients: /\b(after|before|on|today|this week|between|value|follow up|connected|status|contract signed|terms|gst|gstin|pan|consultant|contact|client|location|region|sector|mobile|phone|email|linkedin|starts with)\b|[<>=]/i,
    candidates: /\b(before|after|on|between|salary|ctc|experience|notice|status|stage|relocate|consultant|client|role|job|designation|mobile|phone|email|skills?|less|above|below)\b|[<>=]/i,
    mandates: /\b(before|after|on|between|budget|status|date|allocation|team lead|tl|consultant|client|role|job role|location|city|vertical|sector)\b|[<>=]/i
  }
  return !(structured[page] || structured.candidates).test(prompt)
}

export const keywordFilters = (page, prompt, fields) => ({
  mode: 'keyword',
  terms: normalizeSearchText(prompt).replace(/^clients?\s+|\s+clients?$/g, '').split(' ').filter(Boolean),
  fields
})

export const filterPills = (filters) => {
  if (!filters) return []
  if (filters.mode === 'keyword') return [`Global: ${(filters.terms || []).join(' ')}`]
  return (filters.conditions || []).map(({ field, operator, value }) => {
    const label = field.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
    const op = operator === 'contains' ? '' : `${operator.replace(/_/g, ' ')} `
    return `${label}: ${op}${Array.isArray(value) ? value.join('-') : value}`
  })
}

export const highlightText = (value, filters) => {
  const text = String(value || '')
  const terms = filters?.mode === 'keyword' ? filters.terms || [] : (filters?.conditions || []).filter(item => item.operator === 'contains').map(item => item.value)
  const needles = terms.map(item => String(item || '').trim()).filter(Boolean)
  if (!text || !needles.length) return text || '-'
  const escaped = needles.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'ig')
  return text.split(regex).map((part, index) => needles.some(item => part.toLowerCase() === item.toLowerCase())
    ? React.createElement('mark', { className: 'ai-filter-highlight', key: `${part}-${index}` }, part)
    : part)
}
