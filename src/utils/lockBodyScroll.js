// Freeze the current viewport without changing the document's reserved scrollbar.
export function lockBodyScroll({ preserveScrollbar = false } = {}) {
  const body = document.body
  const root = document.documentElement
  const previousOverflowY = root.style.overflowY
  // Keep a classic scrollbar's reserved width while the fixed body is frozen.
  if (preserveScrollbar && window.innerWidth > root.clientWidth) root.style.overflowY = 'scroll'
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const properties = ['position', 'top', 'left', 'right', 'width', 'overflow']
  const previous = Object.fromEntries(properties.map(property => [property, body.style[property]]))
  Object.assign(body.style, {
    position: 'fixed', top: `${-scrollY}px`, left: `${-scrollX}px`, right: '0', width: '100%', overflow: 'hidden',
  })
  return () => {
    Object.assign(body.style, previous)
    if (preserveScrollbar) root.style.overflowY = previousOverflowY
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' })
  }
}
