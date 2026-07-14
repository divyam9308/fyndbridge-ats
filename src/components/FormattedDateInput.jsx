import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDateDDMMYYYY } from '../utils/dateFormat'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

const dateFromValue = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return new Date()
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? new Date() : date
}

const isoFromDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const calendarDays = (monthDate) => {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

export default function FormattedDateInput({ value, onChange, className = 'form-control', disabled = false, name, id }) {
  const [displayValue, setDisplayValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromValue(value))
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const openCalendar = () => {
    if (disabled) return
    setVisibleMonth(dateFromValue(value))
    setIsOpen(true)
  }

  const changeMonth = (offset) => {
    setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const selectDate = (date) => {
    onChange(isoFromDate(date))
    setDisplayValue('')
    setIsEditing(false)
    setIsOpen(false)
  }

  const days = calendarDays(visibleMonth)
  const today = isoFromDate(new Date())

  return (
    <span className="formatted-date-input" ref={containerRef}>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={isEditing ? displayValue : toDisplayValue(value)}
        onClick={openCalendar}
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
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      />

      {isOpen && (
        <span className="formatted-date-calendar" role="dialog" aria-label="Choose a date" onClick={(event) => event.stopPropagation()}>
          <span className="formatted-date-calendar-header">
            <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <strong>{MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</strong>
            <button type="button" onClick={() => changeMonth(1)} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </span>

          <span className="formatted-date-weekdays" aria-hidden="true">
            {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </span>

          <span className="formatted-date-days">
            {days.map((date) => {
              const isoDate = isoFromDate(date)
              const isSelected = isoDate === value
              const isToday = isoDate === today
              const isOutsideMonth = date.getMonth() !== visibleMonth.getMonth()
              return (
                <button
                  type="button"
                  key={isoDate}
                  className={`${isSelected ? 'is-selected ' : ''}${isToday ? 'is-today ' : ''}${isOutsideMonth ? 'is-outside' : ''}`.trim()}
                  onClick={() => selectDate(date)}
                  aria-label={date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  aria-pressed={isSelected}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </span>
        </span>
      )}
    </span>
  )
}
