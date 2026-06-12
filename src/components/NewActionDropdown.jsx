import { useEffect, useRef, useState } from 'react'
import { Briefcase, Building2, Plus, Upload, UserPlus } from 'lucide-react'

export default function NewActionDropdown({ onUploadResumes, onAddCandidate, onAddClient, onAddJob }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const item = (label, Icon, action) => (
    <button
      className="new-action-item"
      type="button"
      onClick={() => {
        setOpen(false)
        action?.()
      }}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="new-action-control" ref={ref}>
      <button className="btn-primary new-action-btn" type="button" onClick={() => setOpen(value => !value)}>
        <span>New</span>
        <Plus size={15} className={open ? 'new-action-plus is-open' : 'new-action-plus'} />
      </button>
      {open && (
        <div className="filter-dropdown new-action-dropdown">
          {item('Upload resumes', Upload, onUploadResumes)}
          {item('Add candidate', UserPlus, onAddCandidate)}
          {item('Add client', Building2, onAddClient)}
          {item('Add mandate', Briefcase, onAddJob)}
        </div>
      )}
    </div>
  )
}
