import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function FloatingDropdown({ anchorRect, ignoreElement, onClose, className = '', width, minWidth = 180, children }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ visibility: 'hidden' })
  const canUseDom = typeof document !== 'undefined' && Boolean(document.body)
  const validRect = anchorRect && Number.isFinite(anchorRect.left) && Number.isFinite(anchorRect.bottom)

  useEffect(() => {
    if (!canUseDom) return undefined
    const closeOnMouseDown = (event) => {
      if (ref.current?.contains(event.target)) return
      if (ignoreElement?.contains(event.target)) return
      onClose()
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    const closeOnScroll = (event) => {
      if (ref.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('mousedown', closeOnMouseDown)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('mousedown', closeOnMouseDown)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [canUseDom, onClose])

  useLayoutEffect(() => {
    if (!canUseDom || !validRect) return
    const margin = 8
    const nextWidth = width || Math.max(anchorRect.width || 0, minWidth)
    const maxLeft = window.innerWidth - nextWidth - margin
    setStyle({
      position: 'fixed',
      top: anchorRect.bottom + 6,
      left: Math.max(margin, Math.min(anchorRect.left, maxLeft)),
      width: nextWidth,
      zIndex: 10050,
      visibility: 'visible',
    })
  }, [anchorRect, canUseDom, minWidth, validRect, width])

  if (!canUseDom || !validRect) return null

  return createPortal(
    <div ref={ref} className={`filter-dropdown floating-dropdown ${className}`} style={style}>
      {children}
    </div>,
    document.body
  )
}
