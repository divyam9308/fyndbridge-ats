import { Lock, Unlock } from 'lucide-react'
import { setRecordLock } from '../../services/adminAccessApi'

export default function RecordLockButton({ tableName, recordId, locked, onChanged, disabled = false }) {
  const nextLocked = !locked
  const Icon = locked ? Unlock : Lock
  const title = locked ? 'Unlock record' : 'Lock record'

  const handleClick = async (event) => {
    event.stopPropagation()
    if (!recordId || disabled) return
    const result = await setRecordLock(tableName, recordId, nextLocked)
    onChanged?.(result.data)
  }

  return (
    <button className="row-action-btn" type="button" title={title} aria-label={title} onClick={handleClick} disabled={disabled}>
      <Icon size={13} strokeWidth={2} />
    </button>
  )
}
