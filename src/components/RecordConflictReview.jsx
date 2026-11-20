import { useState } from 'react'
import { compareRecordEdits, mergeReviewedEdits } from '../../shared/recordConflicts.js'

export default function RecordConflictReview({ fields, original, draft, latest, busy, onLoadLatest, onResolved, formatValue = value => String(value ?? '') || '—' }) {
  const [choices, setChoices] = useState({})
  if (!latest) return <button type="button" className="btn-secondary" disabled={busy} onClick={onLoadLatest}>Review latest changes</button>
  const comparisons = compareRecordEdits(fields, original, draft, latest)
  const unresolved = comparisons.some(field => field.conflict && !choices[field.key])
  return <section aria-label="Review conflicting changes">
    <p>Your unsaved edits are still in the form. Unchanged fields will use the latest saved values. Choose which value to keep where both copies changed.</p>
    {comparisons.map(field => <div className="form-group" key={field.key}>
      <strong>{field.label}</strong>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Latest saved: {formatValue(latest[field.key], field.key)}</div>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Your edit: {formatValue(draft[field.key], field.key)}</div>
      {field.conflict ? <label>Keep which {field.label.toLowerCase()}?<select className="form-control" aria-label={`Keep which ${field.label.toLowerCase()}?`} value={choices[field.key] || ''} disabled={busy} onChange={event => setChoices(current => ({ ...current, [field.key]: event.target.value }))}>
        <option value="">Choose a value</option><option value="latest">Latest saved value</option><option value="mine">My edit</option>
      </select></label> : <span>{field.yoursChanged ? 'Your edit will be kept.' : 'The latest saved value will be kept.'}</span>}
    </div>)}
    <button type="button" className="btn-secondary" disabled={busy || unresolved} onClick={() => onResolved(mergeReviewedEdits(fields, original, draft, latest, choices))}>Continue with reviewed edits</button>
    <p>Nothing is saved until you review the form and press Save again.</p>
  </section>
}
