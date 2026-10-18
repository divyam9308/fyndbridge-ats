import { createPortal } from 'react-dom'
import './FloatingActionDock.css'

// Keep mounted so both entrance and exit transitions run. Inert also removes
// hidden buttons from keyboard navigation, unlike pointer-events alone.
export default function FloatingActionDock({ visible, className = '', innerClassName = '', children, label }) {
  return createPortal(
    <div className={`floating-action-dock ${className}${visible ? ' is-visible' : ''}`} aria-label={label} aria-hidden={!visible} inert={!visible}>
      <div className={`floating-action-dock-inner ${innerClassName}`}>{children}</div>
    </div>,
    document.body,
  )
}
