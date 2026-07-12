import { Check, Eye, EyeOff, Lock } from 'lucide-react'

const OPTIONS = [
  { value: 'everyone', label: 'Everyone', Icon: Eye },
  { value: 'admin_disabled', label: 'Admin · Disabled', Icon: Lock },
  { value: 'admin_hidden', label: 'Admin · Hidden', Icon: EyeOff }
]

export default function AdminPermissionPicker({ value, onChange, options = OPTIONS, disabled = false, toneForValue }) {
  const index = Math.max(0, options.findIndex(option => option.value === value))
  const tone = toneForValue?.(value) || (value === 'everyone' ? 'is-everyone' : value.includes('disabled') ? 'is-disabled' : 'is-hidden')
  return (
    <div className="admin-permission-picker" style={{ '--admin-permission-option-count': options.length }}>
      <span className={`admin-permission-indicator ${tone}`} style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map(({ value: optionValue, label, Icon }) => {
        const active = optionValue === value
        return (
          <button key={optionValue} type="button" disabled={disabled} className={`admin-permission-option${active ? ' is-active' : ''}`} onClick={() => onChange(optionValue)}>
            {active ? <Check size={13} /> : <Icon size={13} />}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
