const CATEGORIES = Object.freeze(['clients', 'mandates', 'candidates'])
const MODES = new Set(['none', 'selected', 'all'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function bad(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

function ids(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) bad(`${label} must be an array.`)
  const result = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
  if (result.some((id) => !UUID.test(id))) bad(`${label} contains an invalid record ID.`)
  return result
}

function normalizeCategorySelection(value, category) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const mode = input.mode || 'none'
  if (!MODES.has(mode)) bad(`Invalid ${category} selection mode.`)
  const selectedIds = ids(input.selected_ids ?? input.selectedIds, `${category} selected IDs`)
  const excludedIds = ids(input.excluded_ids ?? input.excludedIds, `${category} excluded IDs`)
  if (mode === 'none' && (selectedIds.length || excludedIds.length)) bad(`${category} has IDs but no selection mode.`)
  if (mode === 'selected' && excludedIds.length) bad(`${category} selected mode cannot contain exclusions.`)
  if (mode === 'all' && selectedIds.length) bad(`${category} Select All cannot contain selected IDs.`)
  return { mode, selected_ids: selectedIds, excluded_ids: excludedIds }
}

function normalizeSelections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Selections are required.')
  const result = Object.fromEntries(CATEGORIES.map((category) => [category, normalizeCategorySelection(value[category], category)]))
  const hasSelection = CATEGORIES.some((category) => result[category].mode === 'all' || result[category].selected_ids.length)
  if (!hasSelection) bad('Select at least one record to reassign.')
  return result
}

module.exports = { CATEGORIES, normalizeCategorySelection, normalizeSelections }
