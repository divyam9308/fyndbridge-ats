import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function TablePopover({ anchorRect, onClose, width = 180, children }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ visibility: 'hidden' })
  const canUseDom = typeof document !== 'undefined' && Boolean(document.body)
  const validRect = anchorRect && Number.isFinite(anchorRect.left) && Number.isFinite(anchorRect.top)

  useEffect(() => {
    if (!canUseDom) return undefined
    const close = (event) => {
      if (ref.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [canUseDom, onClose])

  useLayoutEffect(() => {
    if (!canUseDom || !validRect || !ref.current) return
    const gap = 6
    const margin = 8
    const height = ref.current.offsetHeight
    const maxLeft = window.innerWidth - width - margin
    const left = Math.max(margin, Math.min(anchorRect.left, maxLeft))
    const below = anchorRect.bottom + gap
    const above = anchorRect.top - height - gap
    const top = window.innerHeight - anchorRect.bottom < height + margin && above > margin ? above : below
    setStyle({ position: 'fixed', top, left, width, zIndex: 10000, visibility: 'visible' })
  }, [anchorRect, canUseDom, validRect, width])

  if (!canUseDom || !validRect) return null

  return createPortal(
    <div ref={ref} className="filter-dropdown table-portal-popover" style={style} onMouseDown={event => event.stopPropagation()}>
      {children}
    </div>,
    document.body
  )
}
