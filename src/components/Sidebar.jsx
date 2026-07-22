import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import {
  LayoutDashboard, Briefcase, Building2, ClipboardList, Users, LogOut, ShieldCheck, FileText, BookOpenText, CalendarCheck, ChartNoAxesCombined, ExternalLink, UserRoundCheck
} from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'
import { preloadRoute } from '../utils/routePreload'
import { apiFetch } from '../services/apiClient'
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

const trailingNavItems = [
  { to: '/open-roles', label: 'Public Roles', key: 'public_roles', Icon: ExternalLink, external: true },
  { to: '/dashboard/applied-candidates', label: 'Applied Candidates', key: 'applied_candidates', Icon: UserRoundCheck },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { isAdmin, isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const pageViews = usePageViewPermissions({ isAdmin, isSuperAdmin })
  const canViewAppliedCandidates = !pageViews.loading && pageViews.canView('applied_candidates')
  const [counts, setCounts] = useState({ public_roles: null, applied_candidates: null })
  const displayName = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Recruiter'
  const initials = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  const handleLogout = () => signOut()

  const refreshSidebarCounts = useCallback(async () => {
    if (pageViews.loading) return
    const requests = [
      window.fetch('/api/public/open-roles/count', { cache: 'no-store' })
        .then(async response => {
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || 'Public role count failed')
          return ['public_roles', Number(payload.count || 0)]
        }),
    ]
    if (canViewAppliedCandidates) {
      requests.push(
        apiFetch('/api/applied-candidates/count', { cache: 'no-store' })
          .then(async response => {
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(payload.error || 'Applied candidate count failed')
            return ['applied_candidates', Number(payload.count || 0)]
          }),
      )
    }
    const results = await Promise.allSettled(requests)
    setCounts(current => {
      const next = { ...current }
      results.forEach(result => {
        if (result.status === 'fulfilled') next[result.value[0]] = result.value[1]
      })
      return next
    })
  }, [canViewAppliedCandidates, pageViews.loading])

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

  useEffect(() => {
    const frame = window.requestAnimationFrame(refreshSidebarCounts)
    return () => window.cancelAnimationFrame(frame)
  }, [refreshSidebarCounts])

  useEffect(() => {
    const refresh = () => refreshSidebarCounts()
    const refreshFromStorage = event => {
      if (event.key === 'ats:sidebar-counts-refresh') refreshSidebarCounts()
    }
    window.addEventListener('ats:jobs-updated', refresh)
    window.addEventListener('ats:public-roles-updated', refresh)
    window.addEventListener('ats:applied-candidates-updated', refresh)
    window.addEventListener('storage', refreshFromStorage)
    return () => {
      window.removeEventListener('ats:jobs-updated', refresh)
      window.removeEventListener('ats:public-roles-updated', refresh)
      window.removeEventListener('ats:applied-candidates-updated', refresh)
      window.removeEventListener('storage', refreshFromStorage)
    }
  }, [refreshSidebarCounts])

  const preload = (to) => {
    preloadRoute(to)
  }

  const navigateFromPerformancePointer = (event, to) => {
    if (location.pathname !== '/dashboard/performance') return
    if (event.isPrimary === false || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    navigate(to)
  }

  const renderNavItem = ({ to, label, key, Icon, end, external }) => external ? (
    <a className="sidebar-nav-link" href={to} target="_blank" rel="noopener noreferrer" id="nav-public-roles" key={to}>
      <span className="nav-icon"><Icon size={17} strokeWidth={1.8} /></span>
      <span className="sidebar-nav-label">{label}</span>
      {Number.isFinite(counts[key]) && <span className="sidebar-count-badge" aria-label={`${label}: ${counts[key]}`}>{counts[key] > 99 ? '99+' : counts[key]}</span>}
    </a>
  ) : (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        `sidebar-nav-link${isActive ? ' active' : ''}`
      }
      id={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onPointerEnter={() => preload(to)}
      onPointerDown={(event) => navigateFromPerformancePointer(event, to)}
      onFocus={() => preload(to)}
    >
      <span className="nav-icon"><Icon size={17} strokeWidth={1.8} /></span>
      <span className="sidebar-nav-label">{label}</span>
      {Number.isFinite(counts[key]) && <span className="sidebar-count-badge" aria-label={`${label}: ${counts[key]}`}>{counts[key] > 99 ? '99+' : counts[key]}</span>}
    </NavLink>
  )

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <img
          src="/assets/fynd-sidebar-logo.png"
          alt="FYND"
          className="sidebar-logo-image"
          width="2000"
          height="2000"
          decoding="async"
          onError={() => console.error('FYND sidebar logo failed to load')}
        />
      </div>

      {/* Nav links */}
      <nav className="sidebar-nav">
        {!pageViews.loading && navItems.filter(item => pageViews.canView(item.key)).map(renderNavItem)}
        {!pageViews.loading && pageViews.canView('invoice') && (
          <>
          <NavLink
            to="/invoice"
            className={({ isActive }) =>
              `sidebar-nav-link${isActive ? ' active' : ''}`
            }
            id="nav-invoice"
            onPointerEnter={() => preload('/invoice')}
            onPointerDown={(event) => navigateFromPerformancePointer(event, '/invoice')}
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
            onPointerDown={(event) => navigateFromPerformancePointer(event, '/dashboard/admin')}
            onFocus={() => preload('/dashboard/admin')}
          >
            <span className="nav-icon"><ShieldCheck size={17} strokeWidth={1.8} /></span>
            <span className="sidebar-nav-label">Admin Panel</span>
          </NavLink>
          </>
        )}
        {!pageViews.loading && trailingNavItems.filter(item => item.external || pageViews.canView(item.key)).map(renderNavItem)}
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
