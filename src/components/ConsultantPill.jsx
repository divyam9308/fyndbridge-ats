import { cleanConsultantName, getConsultantAvatarColor, getConsultantInitials } from '../utils/consultantPill'

export function ConsultantPill({ name, extraCount = 0, onClick }) {
  const consultant = cleanConsultantName(name)
  if (!consultant || consultant === '-') return <span className="consultant-pill-empty">-</span>
  const content = <><span className="consultant-pill-avatar" style={{ backgroundColor: getConsultantAvatarColor(consultant) }}>{getConsultantInitials(consultant)}</span><span className="consultant-pill-name" title={consultant}>{consultant}</span>{extraCount > 0 ? <span className="consultant-pill-more">+{extraCount}</span> : null}</>
  return onClick ? <button type="button" className="consultant-pill is-interactive" onMouseDown={event => event.stopPropagation()} onClick={onClick}>{content}</button> : <span className="consultant-pill">{content}</span>
}

export function ConsultantPillGroup({ consultants, onClick }) {
  const names = (Array.isArray(consultants) ? consultants : [consultants]).map(cleanConsultantName).filter(name => name && name !== '-')
  if (!names.length) return <span className="consultant-pill-empty">-</span>
  return <ConsultantPill name={names[0]} extraCount={names.length - 1} onClick={names.length > 1 ? onClick : undefined} />
}
