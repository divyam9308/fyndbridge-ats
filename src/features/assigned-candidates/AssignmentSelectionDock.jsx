import { ListChecks, Plus, Trash2, X } from 'lucide-react'
import FloatingActionDock from '../../components/FloatingActionDock'
import './AssignmentSelectionDock.css'

export default function AssignmentSelectionDock({ count, admin, canAdd, hidden, onClear, onDelete, onAdd }) {
  const visible = count > 0 && !hidden
  return <FloatingActionDock visible={visible} className={`assigned-selection-dock${admin ? ' has-delete' : ''}`} label="Selected assigned candidates">
    <span aria-hidden="true"><ListChecks size={18} /></span>
    <div><strong aria-live="polite">{count} {count === 1 ? 'candidate' : 'candidates'} selected</strong>
      <p>{canAdd ? 'Review the selected candidates, then save them together.' : 'To add, select contacted candidates that have not already been added.'}</p></div>
    <button className="assigned-dock-clear" type="button" disabled={!visible} onClick={onClear}><X size={16} />Clear selection</button>
    {admin && <button className="assigned-dock-delete" type="button" disabled={!visible} onClick={onDelete}><Trash2 size={16} />Delete selected ({count})</button>}
    <button className="btn-primary assigned-dock-add" type="button" disabled={!visible || !canAdd} onClick={onAdd}><Plus size={16} />Add to Candidates ({count})</button>
  </FloatingActionDock>
}
