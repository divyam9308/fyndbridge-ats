import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function FloatingDropdown({ anchorRect, ignoreElement, onClose, className = '', width, minWidth = 180, fitViewport = false, children }) {
  const ref = useRef(null)
  const canUseDom = typeof document !== 'undefined' && Boolean(document.body)
  const validRect = anchorRect && Number.isFinite(anchorRect.left) && Number.isFinite(anchorRect.bottom)
  const requestedWidth = validRect ? width || Math.max(anchorRect.width || 0, minWidth) : minWidth
  const nextWidth = fitViewport && canUseDom ? Math.min(requestedWidth, window.innerWidth - 16) : requestedWidth
  const style = validRect && canUseDom ? {
    position: 'fixed',
    top: anchorRect.bottom + 6,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - nextWidth - 8)),
    width: nextWidth,
    zIndex: 10050,
    visibility: 'visible',
  } : { visibility: 'hidden' }

  useLayoutEffect(() => {
    const node = ref.current
    if (!fitViewport || !node || !validRect) return
    const below = Math.max(0, window.innerHeight - anchorRect.bottom - 14)
    const above = Math.max(0, anchorRect.top - 14)
    const maximumHeight = parseFloat(window.getComputedStyle(node).maxHeight) || Infinity
    const openAbove = node.getBoundingClientRect().height > below && above > below
    node.style.maxHeight = `${Math.min(maximumHeight, openAbove ? above : below)}px`
    node.style.overflowY = 'auto'
    const height = node.getBoundingClientRect().height
    node.style.top = `${openAbove ? Math.max(8, anchorRect.top - height - 6) : anchorRect.bottom + 6}px`
  }, [fitViewport, validRect, anchorRect, nextWidth, children])

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
      if (fitViewport && ignoreElement?.isConnected) {
        const current = ignoreElement.getBoundingClientRect()
        // A click can reveal its table cell before the scroll event is delivered.
        // Keep the newly opened menu when its anchor has not moved since opening.
        if (Math.abs(current.left - anchorRect.left) < 1 && Math.abs(current.top - anchorRect.top) < 1) return
      }
      onClose()
    }
    document.addEventListener('mousedown', closeOnMouseDown)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', closeOnScroll, true)
    if (fitViewport) window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', closeOnMouseDown)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', closeOnScroll, true)
      if (fitViewport) window.removeEventListener('resize', onClose)
    }
  }, [anchorRect, canUseDom, fitViewport, ignoreElement, onClose])

  if (!canUseDom || !validRect) return null

  return createPortal(
    <div ref={ref} className={`filter-dropdown floating-dropdown ${className}`} style={style}>
      {children}
    </div>,
    document.body
  )
}
