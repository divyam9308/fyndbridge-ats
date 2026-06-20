import { Check, Eye, EyeOff, Lock } from 'lucide-react'

const OPTIONS = [
  { value: 'everyone', label: 'Everyone', Icon: Eye },
  { value: 'admin_disabled', label: 'Admin Disabled', Icon: Lock },
  { value: 'admin_hidden', label: 'Admin Hidden', Icon: EyeOff }
]

export default function AdminPermissionPicker({ value, onChange }) {
  const index = Math.max(0, OPTIONS.findIndex(option => option.value === value))
  const tone = value === 'everyone' ? 'is-everyone' : value === 'admin_disabled' ? 'is-disabled' : 'is-hidden'
  return (
    <div className="admin-permission-picker">
      <span className={`admin-permission-indicator ${tone}`} style={{ transform: `translateX(${index * 100}%)` }} />
      {OPTIONS.map(({ value: optionValue, label, Icon }) => {
        const active = optionValue === value
        return (
          <button key={optionValue} type="button" className={`admin-permission-option${active ? ' is-active' : ''}`} onClick={() => onChange(optionValue)}>
            {active ? <Check size={13} /> : <Icon size={13} />}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
