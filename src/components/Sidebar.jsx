import { NavLink } from 'react-router-dom'
import { useEffect } from 'react'
import {
  LayoutDashboard, Briefcase, Building2, ClipboardList, Users, LogOut, ShieldCheck, FileText, BookOpenText, CalendarCheck, ChartNoAxesCombined
} from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'
import { preloadRoute } from '../utils/routePreload'
import './Sidebar.css'

const navItems = [
  { to: '/dashboard',            label: 'Dashboard', key: 'dashboard', Icon: LayoutDashboard, end: true },
  { to: '/dashboard/jobs',       label: 'Mandates', key: 'mandates', Icon: Briefcase },
  { to: '/dashboard/clients',    label: 'Clients', key: 'clients', Icon: Building2 },
  { to: '/dashboard/candidates', label: 'Candidates', key: 'candidates', Icon: Users },
  { to: '/dashboard/attendance', label: 'Attendance', key: 'attendance', Icon: CalendarCheck },
  { to: '/dashboard/reports/consultant', label: 'Report', key: 'report', Icon: ChartNoAxesCombined },
  { to: '/dashboard/performance', label: 'PMS', key: 'performance_review', Icon: ClipboardList },
  { to: '/dashboard/user-manual', label: 'User Manual', key: 'user_manual', Icon: BookOpenText },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const { isAdmin, isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const pageViews = usePageViewPermissions({ isAdmin, isSuperAdmin })
  const displayName = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Recruiter'
  const initials = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  const handleLogout = () => signOut()

  useEffect(() => {
    preloadRoute('/dashboard/performance')
    preloadRoute('/dashboard/attendance')
    preloadRoute('/dashboard/reports/consultant')
    preloadRoute('/dashboard/user-manual')
    if (isAdmin) {
      preloadRoute('/invoice')
      preloadRoute('/dashboard/admin')
    }
  }, [isAdmin])

  const preload = (to) => {
    preloadRoute(to)
  }

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <picture>
          <source
            srcSet="/assets/fyndbridge-official-logo-380.webp 380w, /assets/fyndbridge-official-logo.webp 543w"
            sizes="212px"
            type="image/webp"
          />
          <img
            src="/assets/fyndbridge-official-logo.png"
            alt="FYNDBRIDGE"
            className="sidebar-logo-image"
            width="380"
            height="63"
            decoding="async"
            onError={() => console.error('FYNDBRIDGE logo failed to load')}
          />
        </picture>
      </div>

      {/* Nav links */}
      <nav className="sidebar-nav">
        {!pageViews.loading && navItems.filter(item => pageViews.canView(item.key)).map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `sidebar-nav-link${isActive ? ' active' : ''}`
            }
            id={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
            onPointerEnter={() => preload(to)}
            onFocus={() => preload(to)}
          >
            <span className="nav-icon"><Icon size={17} strokeWidth={1.8} /></span>
            <span className="sidebar-nav-label">{label}</span>
          </NavLink>
        ))}
        {!pageViews.loading && pageViews.canView('invoice') && (
          <>
          <NavLink
            to="/invoice"
            className={({ isActive }) =>
              `sidebar-nav-link${isActive ? ' active' : ''}`
            }
            id="nav-invoice"
            onPointerEnter={() => preload('/invoice')}
            onFocus={() => preload('/invoice')}
          >
            <span className="nav-icon"><FileText size={17} strokeWidth={1.8} /></span>
            <span className="sidebar-nav-label">Invoice</span>
          </NavLink>
          <NavLink
            to="/dashboard/admin"
            className={({ isActive }) =>
              `sidebar-nav-link${isActive ? ' active' : ''}`
            }
            id="nav-admin-panel"
            onPointerEnter={() => preload('/dashboard/admin')}
            onFocus={() => preload('/dashboard/admin')}
          >
            <span className="nav-icon"><ShieldCheck size={17} strokeWidth={1.8} /></span>
            <span className="sidebar-nav-label">Admin Panel</span>
          </NavLink>
          </>
        )}
      </nav>

      {/* Bottom user + logout */}
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials || 'HR'}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
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
