import { useState } from 'react'

// Keep list/realtime responses fetched before a status save from undoing its preview.
// Existing page state owns rendering; this guard owns synchronous locks and revisions.
export function useStatusMutationGuard() {
  const [guard] = useState(() => {
    const pending = new Set()
    let revision = 0
    return {
      begin(id) {
        if (pending.has(id)) return false
        pending.add(id); revision += 1
        return true
      },
      finish(id) { pending.delete(id); revision += 1 },
      snapshot: () => revision,
      accepts: snapshot => snapshot === revision && pending.size === 0,
      hasPending: () => pending.size > 0
    }
  })
  return guard
}
