import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './OnlineUsersStrip.css'

const MOCK_ONLINE_USERS = [
  { id: '1', name: 'Divyam Aggarwal', email: 'divyam@fyndbridge.in', role: 'Admin', status: 'online' },
  { id: '2', name: 'Rahul Sharma', email: 'rahul@fyndbridge.in', role: 'Consultant', status: 'online' },
  { id: '3', name: 'Ananya Patel', email: 'ananya@fyndbridge.in', role: 'Consultant', status: 'online' },
  { id: '4', name: 'Sneha Prakash', email: 'sneha@fyndbridge.in', role: 'Research Associate', status: 'online' },
  { id: '5', name: 'Amit Kumar', email: 'amit@fyndbridge.in', role: 'Consultant', status: 'online' },
  { id: '6', name: 'Neha Pillai', email: 'neha@fyndbridge.in', role: 'Research Associate', status: 'online' },
  { id: '7', name: 'Mohit Bansal', email: 'mohit@fyndbridge.in', role: 'Consultant', status: 'online' },
  { id: '8', name: 'Vivek Gupta', email: 'vivek@fyndbridge.in', role: 'Consultant', status: 'online' }
]

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

function UserDetails({ user }) {
  return <><div className="online-users-tooltip-status"><i />Online</div><strong>{user.name || user.email || 'User'}</strong>{user.role ? <span>{user.role}</span> : null}{user.email ? <small>{user.email}</small> : null}</>
}

function OnlineUserAvatar({ user, index, onShow, onHide }) {
  const show = event => onShow({ user, rect: event.currentTarget.getBoundingClientRect() })
  return <button type="button" className="online-users-avatar" style={{ '--avatar-gradient': AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length] }} aria-label={`${user.name || user.email || 'User'} is online`} onMouseEnter={show} onMouseLeave={onHide} onFocus={show} onBlur={onHide}>{userInitials(user)}</button>
}

export default function OnlineUsersStrip({ users = MOCK_ONLINE_USERS }) {
  const onlineUsers = users.filter(user => user.status === 'online')
  const visible = onlineUsers.slice(0, 8)
  const remaining = onlineUsers.slice(8)
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

  const showRemaining = event => setActive({ users: remaining, rect: event.currentTarget.getBoundingClientRect() })
  return <section className="ats-online-users-strip" aria-label={`${onlineUsers.length} users online`}>
    <div className="ats-online-users-summary"><i /><strong>{onlineUsers.length} Online</strong></div>
    <div className="ats-online-users-list">
      {visible.map((user, index) => <OnlineUserAvatar key={user.id || user.email} user={user} index={index} onShow={setActive} onHide={() => setActive(null)} />)}
      {remaining.length ? <button type="button" className="online-users-avatar is-more" aria-label={`${remaining.length} more online users`} onMouseEnter={showRemaining} onMouseLeave={() => setActive(null)} onFocus={showRemaining} onBlur={() => setActive(null)}>+{remaining.length}</button> : null}
    </div>
    {active ? createPortal(<div className={`online-users-tooltip${active.users ? ' is-list' : ''}`} style={tooltipPosition(active.rect, active.users?.length || 1)} role="tooltip">{active.users ? <><div className="online-users-tooltip-heading"><i />{active.users.length} more online</div><div className="online-users-tooltip-list">{active.users.map(user => <div key={user.id || user.email} className="online-users-tooltip-user"><span>{userInitials(user)}</span><div><strong>{user.name || user.email || 'User'}</strong>{user.role ? <small>{user.role}</small> : null}</div></div>)}</div></> : <UserDetails user={active.user} />}</div>, document.body) : null}
  </section>
}
