export const EMPTY_CATEGORY_SELECTION = Object.freeze({ mode: 'none', selectedIds: [], excludedIds: [] })

export function createEmptySelections() {
  return {
    clients: { ...EMPTY_CATEGORY_SELECTION },
    mandates: { ...EMPTY_CATEGORY_SELECTION },
    candidates: { ...EMPTY_CATEGORY_SELECTION }
  }
}

const unique = (values) => [...new Set((values || []).filter(Boolean))]

export function isRecordSelected(selection, recordId) {
  if (selection?.mode === 'all') return !selection.excludedIds.includes(recordId)
  return selection?.mode === 'selected' && selection.selectedIds.includes(recordId)
}

export function toggleRecordSelection(selection, recordId, checked) {
  if (selection.mode === 'all') {
    const excludedIds = checked
      ? selection.excludedIds.filter((id) => id !== recordId)
      : unique([...selection.excludedIds, recordId])
    return { mode: 'all', selectedIds: [], excludedIds }
  }
  const selectedIds = checked
    ? unique([...selection.selectedIds, recordId])
    : selection.selectedIds.filter((id) => id !== recordId)
  return selectedIds.length
    ? { mode: 'selected', selectedIds, excludedIds: [] }
    : { ...EMPTY_CATEGORY_SELECTION }
}

export function toggleAllSelection(checked) {
  return checked
    ? { mode: 'all', selectedIds: [], excludedIds: [] }
    : { ...EMPTY_CATEGORY_SELECTION }
}

export function selectedRecordCount(selection, total) {
  if (selection?.mode === 'all') return Math.max(0, Number(total || 0) - unique(selection.excludedIds).length)
  if (selection?.mode === 'selected') return unique(selection.selectedIds).length
  return 0
}

export function selectAllState(selection, total) {
  const count = selectedRecordCount(selection, total)
  return {
    checked: Number(total || 0) > 0 && count === Number(total),
    indeterminate: count > 0 && count < Number(total || 0)
  }
}

export function selectionPayload(selections) {
  return Object.fromEntries(Object.entries(selections).map(([key, value]) => [key, {
    mode: value.mode,
    selected_ids: unique(value.selectedIds),
    excluded_ids: unique(value.excludedIds)
  }]))
}
