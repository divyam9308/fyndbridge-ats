import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function useDialogFocus(onClose, { closeDisabled = false } = {}) {
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)

  useEffect(() => {
    closeRef.current = onClose
    closeDisabledRef.current = closeDisabled
  }, [closeDisabled, onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const previouslyFocused = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      const first = dialog.querySelector('[data-autofocus], input, select, textarea, button:not([disabled]), [href]')
      first?.focus()
    })
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => element.getClientRects().length)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return dialogRef
}
