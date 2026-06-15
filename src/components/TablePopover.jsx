import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function TablePopover({ anchorRect, anchorEl, onClose, width = 180, children }) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ visibility: 'hidden' })
  const canUseDom = typeof document !== 'undefined' && Boolean(document.body)
  const getRect = useCallback(() => anchorEl?.isConnected ? anchorEl.getBoundingClientRect() : anchorRect, [anchorEl, anchorRect])
  const validRect = (() => {
    const rect = getRect()
    return rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
  })()

  const updatePosition = useCallback(() => {
    if (!canUseDom || !ref.current) return
    const rect = getRect()
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return
    const gap = 6
    const margin = 8
    const height = ref.current.offsetHeight
    const maxLeft = window.innerWidth - width - margin
    const left = Math.max(margin, Math.min(rect.left, maxLeft))
    const below = rect.bottom + gap
    const above = rect.top - height - gap
    const top = window.innerHeight - rect.bottom < height + margin && above > margin ? above : below
    setStyle({ position: 'fixed', top, left, width, zIndex: 10000, visibility: 'visible' })
  }, [canUseDom, getRect, width])

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
    if (!validRect) return
    updatePosition()
  }, [updatePosition, validRect])

  useEffect(() => {
    if (!canUseDom || !validRect) return undefined
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [canUseDom, updatePosition, validRect])

  if (!canUseDom || !validRect) return null

  return createPortal(
    <div ref={ref} className="filter-dropdown table-portal-popover" style={style} onMouseDown={event => event.stopPropagation()}>
      {children}
    </div>,
    document.body
  )
}
