import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './OnlineUsersStrip.css'

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #001264, #31508f)',
  'linear-gradient(135deg, #0f766e, #2dd4bf)',
  'linear-gradient(135deg, #7c3aed, #a78bfa)',
  'linear-gradient(135deg, #be123c, #fb7185)',
  'linear-gradient(135deg, #b45309, #fbbf24)',
  'linear-gradient(135deg, #0369a1, #38bdf8)',
  'linear-gradient(135deg, #166534, #4ade80)',
  'linear-gradient(135deg, #9f1239, #f472b6)'
]

function userInitials(user) {
  if (user?.initials) return user.initials
  const value = String(user?.name || user?.email || '').trim()
  if (!value) return 'U'
  const source = value.includes('@') ? value.split('@')[0].replace(/[._-]+/g, ' ') : value
  const parts = source.split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase()
}

function tooltipPosition(rect, itemCount = 1) {
  const width = itemCount > 1 ? 288 : 250
  const height = itemCount > 1 ? Math.min(280, 56 + itemCount * 52) : 118
  const gap = 10
  const padding = 12
  const left = Math.min(Math.max(padding, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - padding)
  const below = rect.bottom + gap
  const top = below + height <= window.innerHeight - padding ? below : Math.max(padding, rect.top - height - gap)
  return { left, top, width }
}

function statusLabel(status) {
  return status === 'away' ? 'Away' : 'Online'
}

function UserDetails({ user }) {
  return <><div className={`online-users-tooltip-status is-${user.status || 'online'}`}><i />{statusLabel(user.status)}</div><strong>{user.name || user.email || 'User'}</strong>{user.role ? <span>{user.role}</span> : null}{user.email ? <small>{user.email}</small> : null}</>
}

function OnlineUserAvatar({ user, index, onShow, onHide, firstAway }) {
  const show = event => onShow({ user, rect: event.currentTarget.getBoundingClientRect() })
  return <button type="button" className={`online-users-avatar is-${user.status || 'online'}${firstAway ? ' is-first-away' : ''}`} style={{ '--avatar-gradient': AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length] }} aria-label={`${user.name || user.email || 'User'} is ${statusLabel(user.status).toLowerCase()}`} onMouseEnter={show} onMouseLeave={onHide} onFocus={show} onBlur={onHide}>{userInitials(user)}</button>
}

export default function OnlineUsersStrip({ users = [] }) {
  const visibleUsers = users.filter(user => user.status === 'online' || user.status === 'away')
  const onlineUsers = visibleUsers.filter(user => user.status === 'online')
  const awayUsers = visibleUsers.filter(user => user.status === 'away')
  const orderedUsers = [...onlineUsers, ...awayUsers]
  const [active, setActive] = useState(null)

  useEffect(() => {
    if (!active) return undefined
    const close = () => setActive(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [active])

  return <section className="ats-online-users-strip" aria-label={`${onlineUsers.length} online, ${awayUsers.length} away`}>
    <div className="ats-online-users-summary">
      <span className="is-online"><i /><strong>{onlineUsers.length} Online</strong></span>
      <span className="is-away"><i /><strong>{awayUsers.length} Away</strong></span>
    </div>
    <div className="ats-online-users-list">
      {orderedUsers.map((user, index) => <OnlineUserAvatar key={user.id || user.email} user={user} index={index} firstAway={onlineUsers.length > 0 && user.status === 'away' && index === onlineUsers.length} onShow={setActive} onHide={() => setActive(null)} />)}
    </div>
    {active ? createPortal(<div className="online-users-tooltip" style={tooltipPosition(active.rect)} role="tooltip"><UserDetails user={active.user} /></div>, document.body) : null}
  </section>
}
