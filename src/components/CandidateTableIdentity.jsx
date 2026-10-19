const avatarPalette = [
  ['#7c3aed', '#a855f7'], ['#2563eb', '#3b82f6'],
  ['#059669', '#10b981'], ['#ea580c', '#f97316'],
  ['#db2777', '#ec4899'], ['#4f46e5', '#6366f1'],
  ['#65a30d', '#84cc16'], ['#0891b2', '#06b6d4'],
]
const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '-'
const avatarStyle = name => {
  const hash = [...String(name || '').trim()].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [start, end] = avatarPalette[hash % avatarPalette.length]
  return { background: `linear-gradient(135deg, ${start}, ${end})`, color: '#fff' }
}

export function CandidateName({ name, children }) {
  return <div className="name-cell">
    <div className="name-avatar" style={avatarStyle(name)} aria-hidden="true">{initials(name)}</div>
    <div className="candidate-name-content">{children || <div className="name-text candidate-group-name"><span className="candidate-name-text" title={name}>{name || '-'}</span></div>}</div>
  </div>
}

export function ConsultantChip({ name, children }) {
  if (!name) return <span className="candidate-muted-dash">-</span>
  return <span className="candidate-consultant-chip" title={name}>
    <span className="candidate-consultant-avatar" style={avatarStyle(name)} aria-hidden="true">{initials(name)}</span>
    <span>{children || name}</span>
  </span>
}
