import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Briefcase, Building2, Users, Settings, LogOut
} from 'lucide-react'
import './Sidebar.css'

const navItems = [
  { to: '/dashboard',            label: 'Dashboard',  Icon: LayoutDashboard, end: true },
  { to: '/dashboard/jobs',       label: 'Jobs',       Icon: Briefcase },
  { to: '/dashboard/clients',    label: 'Clients',    Icon: Building2 },
  { to: '/dashboard/candidates', label: 'Candidates', Icon: Users },
]

export default function Sidebar() {
  const navigate = useNavigate()

  const handleLogout = () => navigate('/login')

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">
          <span className="logo-fynd">Fynd</span>
          <span className="logo-bridge">bridge</span>
        </div>
        <div className="sidebar-logo-sub">ATS Platform</div>
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
          <div className="sidebar-avatar">SM</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">Sarah Mehta</div>
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
