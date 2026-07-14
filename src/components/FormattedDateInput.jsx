import { useRef, useState } from 'react'
import { formatDateDDMMYYYY } from '../utils/dateFormat'

const toDisplayValue = (value) => {
  const formatted = formatDateDDMMYYYY(value)
  return formatted === '-' ? '' : formatted
}

const normalizeTypedDate = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

const toIsoDate = (value) => {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return ''
  const [, dd, mm, yyyy] = match
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return ''
  return `${yyyy}-${mm}-${dd}`
}

export default function FormattedDateInput({ value, onChange, className = 'form-control', disabled = false, name }) {
  const [displayValue, setDisplayValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const pickerRef = useRef(null)

  const openPicker = () => {
    if (disabled || !pickerRef.current) return
    try {
      if (typeof pickerRef.current.showPicker === 'function') pickerRef.current.showPicker()
      else pickerRef.current.click()
    } catch {
      pickerRef.current.click()
    }
  }

  return (
    <span className="formatted-date-input">
      <input
        name={name}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={isEditing ? displayValue : toDisplayValue(value)}
        onClick={openPicker}
        onFocus={() => {
          setDisplayValue(toDisplayValue(value))
          setIsEditing(true)
        }}
        onChange={(event) => {
          const nextDisplay = normalizeTypedDate(event.target.value)
          setDisplayValue(nextDisplay)
          if (!nextDisplay) onChange('')
          else {
            const isoDate = toIsoDate(nextDisplay)
            if (isoDate) onChange(isoDate)
          }
        }}
        onBlur={() => {
          setIsEditing(false)
          setDisplayValue('')
        }}
        className={className}
        disabled={disabled}
        autoComplete="off"
      />
      <input
        ref={pickerRef}
        className="formatted-date-native-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        onChange={(event) => {
          onChange(event.target.value)
          setDisplayValue('')
          setIsEditing(false)
          pickerRef.current?.blur()
        }}
        disabled={disabled}
      />
    </span>
  )
}
