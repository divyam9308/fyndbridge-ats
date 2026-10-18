// Freeze the current viewport without changing the document's reserved scrollbar.
export function lockBodyScroll() {
  const body = document.body
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const properties = ['position', 'top', 'left', 'right', 'width', 'overflow']
  const previous = Object.fromEntries(properties.map(property => [property, body.style[property]]))
  Object.assign(body.style, {
    position: 'fixed', top: `${-scrollY}px`, left: `${-scrollX}px`, right: '0', width: '100%', overflow: 'hidden',
  })
  return () => {
    Object.assign(body.style, previous)
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' })
  }
}
