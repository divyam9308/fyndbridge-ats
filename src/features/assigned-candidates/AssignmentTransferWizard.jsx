import { lazy, Suspense, useRef, useState } from 'react'
import { assignedRequest } from '../../services/assignedCandidatesApi'

const CandidateForm = lazy(() => import('../../pages/CandidatesPage'))

export default function AssignmentTransferWizard({ assignments, onClose, onSaved }) {
  const [remaining, setRemaining] = useState(assignments)
  const [index, setIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState(null)
  const [progress, setProgress] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const [drafts, setDrafts] = useState(() => new Map())
  const completed = useRef(new Set())
  const saving = useRef(false)
  const current = remaining[index]

  const review = async draft => {
    const reviewedDrafts = new Map(drafts).set(current.id, draft)
    setDrafts(reviewedDrafts)
    if (index < remaining.length - 1) { setFailure(null); setIndex(index + 1); return }
    if (saving.current) return
    saving.current = true
    try {
      for (const [position, row] of remaining.entries()) {
        if (completed.current.has(row.id)) continue
        setProgress(`Saving ${position + 1} of ${remaining.length}`)
        try {
          const reviewed = reviewedDrafts.get(row.id)
          if (!reviewed?.body) throw new Error('Review this candidate before saving.')
          await assignedRequest(`/${row.id}/transfer`, { method: 'POST', body: JSON.stringify(reviewed.body) })
          completed.current.add(row.id)
          setSavedCount(completed.current.size)
        } catch (error) {
          setFailure({ id: row.id, error })
          setRemaining(rows => rows.filter(item => !completed.current.has(item.id)))
          setIndex(0); setAttempt(value => value + 1)
          return
        }
      }
      onSaved([...completed.current])
    } finally { saving.current = false; setProgress('') }
  }

  return <Suspense fallback={<div role="status">Loading candidate form…</div>}>
    <CandidateForm key={`${current.id}-${attempt}`} assignedCandidate={current}
      onAssignedClose={() => { if (!saving.current) onClose([...completed.current]) }}
      assignedBatch={{ index, total: remaining.length, draft: drafts.get(current.id),
        savedCount, progress, error: failure?.id === current.id ? failure.error : null,
        onReview: review,
        onBack: index > 0 ? draft => {
          setDrafts(current => new Map(current).set(remaining[index].id, draft)); setFailure(null); setIndex(index - 1)
        } : null }} />
  </Suspense>
}
