import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Briefcase, Building2, Users, Settings, LogOut
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import FyndbridgeLogo from './FyndbridgeLogo'
import './Sidebar.css'

const navItems = [
  { to: '/dashboard',            label: 'Dashboard',  Icon: LayoutDashboard, end: true },
  { to: '/dashboard/jobs',       label: 'Jobs',       Icon: Briefcase },
  { to: '/dashboard/clients',    label: 'Clients',    Icon: Building2 },
  { to: '/dashboard/candidates', label: 'Candidates', Icon: Users },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Recruiter'
  const initials = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  const handleLogout = () => signOut()

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <FyndbridgeLogo size="md" theme="light" showTagline={true} />
      </div>

      {/* Nav links */}
      <nav className="sidebar-nav">
        {navItems.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `sidebar-nav-link${isActive ? ' active' : ''}`
            }
            id={`nav-${label.toLowerCase()}`}
          >
            <span className="nav-icon"><Icon size={17} strokeWidth={1.8} /></span>
            <span className="sidebar-nav-label">{label}</span>
          </NavLink>
        ))}

        <div className="sidebar-divider" />

        <NavLink
          to="/dashboard/settings"
          className={({ isActive }) =>
            `sidebar-nav-link${isActive ? ' active' : ''}`
          }
          id="nav-settings"
        >
          <span className="nav-icon"><Settings size={17} strokeWidth={1.8} /></span>
          <span className="sidebar-nav-label">Settings</span>
        </NavLink>
      </nav>

      {/* Bottom user + logout */}
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials || 'HR'}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-role">HR Recruiter</div>
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout} id="btn-logout">
          <LogOut size={15} strokeWidth={1.8} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
