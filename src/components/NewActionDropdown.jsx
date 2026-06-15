import { useState } from 'react'
import { Briefcase, Building2, Plus, Upload, UserPlus } from 'lucide-react'
import FloatingDropdown from './FloatingDropdown'

export default function NewActionDropdown({ onUploadResumes, onAddCandidate, onAddClient, onAddJob }) {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)
  const [anchorEl, setAnchorEl] = useState(null)

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
    <div className="new-action-control">
      <button className="btn-primary new-action-btn" type="button" onClick={(event) => { setAnchorRect(event.currentTarget.getBoundingClientRect()); setAnchorEl(event.currentTarget); setOpen(value => !value) }}>
        <span>New</span>
        <Plus size={15} className={open ? 'new-action-plus is-open' : 'new-action-plus'} />
      </button>
      {open && (
        <FloatingDropdown anchorRect={anchorRect} ignoreElement={anchorEl} className="new-action-dropdown" minWidth={178} onClose={() => setOpen(false)}>
          {item('Upload resumes', Upload, onUploadResumes)}
          {item('Add candidate', UserPlus, onAddCandidate)}
          {item('Add client', Building2, onAddClient)}
          {item('Add mandate', Briefcase, onAddJob)}
        </FloatingDropdown>
      )}
    </div>
  )
}
