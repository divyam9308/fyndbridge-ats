const equal = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

export function compareRecordEdits(fields, original, draft, latest) {
  return fields.map(field => {
    const yoursChanged = !equal(draft[field.key], original[field.key])
    const latestChanged = !equal(latest[field.key], original[field.key])
    return { ...field, yoursChanged, latestChanged, conflict: yoursChanged && latestChanged && !equal(draft[field.key], latest[field.key]) }
  }).filter(field => field.yoursChanged || field.latestChanged)
}

export function mergeReviewedEdits(fields, original, draft, latest, choices = {}) {
  const comparisons = compareRecordEdits(fields, original, draft, latest)
  if (comparisons.some(field => field.conflict && !['mine', 'latest'].includes(choices[field.key]))) {
    throw new Error('Choose which value to keep for each conflicting field.')
  }
  const merged = { ...latest }
  for (const field of comparisons) {
    if (field.yoursChanged && (!field.conflict || choices[field.key] === 'mine')) merged[field.key] = draft[field.key]
  }
  return merged
}
