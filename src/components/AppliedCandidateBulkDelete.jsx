import { useEffect, useRef } from 'react'
import { ListChecks, Loader2, Trash2, X } from 'lucide-react'
import FloatingActionDock from './FloatingActionDock'
import { lockBodyScroll } from '../utils/lockBodyScroll'

export function AppliedCandidateSelectionDock({ count, hidden, onClear, onDelete }) {
  const visible = count > 0 && !hidden
  return <FloatingActionDock visible={visible} className="applied-selection-dock" label="Selected applications">
    <span aria-hidden="true"><ListChecks size={18} /></span>
    <div><strong aria-live="polite">{count} {count === 1 ? 'application' : 'applications'} selected</strong><p>Deletion removes the applications and their staged CVs.</p></div>
    <button className="applied-dock-clear" type="button" onClick={onClear} disabled={!visible}><X size={16} />Clear selection</button>
    <button className="applied-dock-delete" type="button" onClick={onDelete} disabled={!visible}><Trash2 size={16} />Delete selected ({count})</button>
  </FloatingActionDock>
}

export function AppliedCandidateDeleteDialog({ count, pending, error, onCancel, onConfirm, returnFocusRef, fallbackRef }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const returnTarget = returnFocusRef.current
    const fallbackTarget = fallbackRef.current
    const unlockScroll = lockBodyScroll()
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      unlockScroll()
      window.requestAnimationFrame(() => {
        const target = returnTarget
        if (target instanceof HTMLElement && document.contains(target) && !target.closest('[inert]') && !target.disabled) target.focus({ preventScroll: true })
        else fallbackTarget?.focus({ preventScroll: true })
      })
    }
  }, [fallbackRef, returnFocusRef])

  return <dialog ref={dialogRef} className="applied-reject-dialog applied-bulk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="applied-bulk-title" aria-describedby="applied-bulk-description" aria-busy={pending} onCancel={event => { event.preventDefault(); if (!pending) onCancel() }}>
    <header><h2 id="applied-bulk-title">Delete {count} {count === 1 ? 'application' : 'applications'}?</h2><button className="modal-close" type="button" onClick={onCancel} disabled={pending} aria-label="Close deletion dialog"><X size={16} /></button></header>
    <div><p id="applied-bulk-description">This will permanently delete {count} {count === 1 ? 'application' : 'applications'} and their staged CVs. Existing candidate master records and adopted CVs are preserved. This cannot be undone.</p>{error && <p className="form-error" role="alert">{error}</p>}{pending && <p role="status">Deleting applications and cleaning up staged CVs…</p>}</div>
    <footer><button ref={cancelRef} className="btn-secondary" type="button" onClick={onCancel} disabled={pending}>Cancel</button><button className="btn-primary applied-danger-button" type="button" onClick={onConfirm} disabled={pending}>{pending ? <><Loader2 size={14} className="spin" />Deleting…</> : `Permanently delete (${count})`}</button></footer>
  </dialog>
}
