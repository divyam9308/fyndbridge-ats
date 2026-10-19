import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The same client-search/suggestion styling used by the Add Candidate form.
export default function AssignmentSelect({ label, value, options, onChange, disabled = false }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  useEffect(() => () => window.clearTimeout(blurTimer.current), [])
  const selected = options.find(option => option.id === value)
  const visibleOptions = options.filter(option => `${option.name} ${option.displayId || ''}`.toLowerCase().includes(search.toLowerCase()))
  useLayoutEffect(() => {
    const list = listRef.current
    const input = inputRef.current
    if (!open || !list || !input) return
    const boundary = input.closest('.modal-body')?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight }
    const rect = input.getBoundingClientRect()
    const below = Math.max(0, Math.min(boundary.bottom, window.innerHeight) - rect.bottom - 10)
    const above = Math.max(0, rect.top - Math.max(boundary.top, 0) - 10)
    const openAbove = below < Math.min(220, list.scrollHeight) && above > below
    list.style.maxHeight = `${Math.min(220, openAbove ? above : below)}px`
    list.style.top = openAbove ? 'auto' : 'calc(100% + 4px)'
    list.style.bottom = openAbove ? 'calc(100% + 4px)' : 'auto'
  }, [open, visibleOptions.length])
  const closeOptions = () => { inputRef.current?.focus({ preventScroll: true }); setOpen(false) }
  return <div className="form-group">
    <label className="form-label">{label}<span className="req"> *</span></label>
    <div className="client-search-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) blurTimer.current = window.setTimeout(() => setOpen(false), 120) }}>
      <input ref={inputRef} className="form-control" aria-label={label} role="combobox" aria-expanded={open} aria-controls={`assigned-${label.replaceAll(' ', '-')}`} autoComplete="off" disabled={disabled}
        value={open ? search : selected?.name || ''} placeholder={`Select ${label.toLowerCase()}`}
        onClick={() => { if (!open) { setSearch(''); setOpen(true) } }}
        onFocus={() => { window.clearTimeout(blurTimer.current); setSearch(''); setOpen(true) }} onChange={event => { setSearch(event.target.value); setOpen(true) }}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); window.requestAnimationFrame(() => listRef.current?.querySelector('button')?.focus({ preventScroll: true })) } }} />
      {open && <div ref={listRef} className="client-suggestions manual-suggestions is-open" role="listbox" id={`assigned-${label.replaceAll(' ', '-')}`} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); closeOptions() }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault()
          const buttons = [...listRef.current.querySelectorAll('button')]
          const index = buttons.indexOf(document.activeElement)
          const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
          next?.focus({ preventScroll: true }); next?.scrollIntoView({ block: 'nearest' })
        }
      }}>
        {visibleOptions.map(option => <button type="button" role="option" aria-selected={option.id === value} key={option.id}
          onMouseDown={event => event.preventDefault()} onClick={() => { window.clearTimeout(blurTimer.current); onChange(option.id); closeOptions() }}>
          <span>{option.name}</span><span className="sub-text">{option.displayId || ''}</span>
        </button>)}
        {!visibleOptions.length && <div className="sub-text">No matching options</div>}
      </div>}
    </div>
  </div>
}
