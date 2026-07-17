import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard, Briefcase, Building2, ClipboardList, Users, LogOut, ShieldCheck, FileText, BookOpenText, CalendarCheck, ChartNoAxesCombined
} from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'
import { preloadRoute } from '../utils/routePreload'
import './Sidebar.css'

// Switch during the completed-logo hold, before the looping GIF starts clearing.
const SIDEBAR_LOGO_ANIMATION_DURATION_MS = 4600
const SIDEBAR_LOGO_ANIMATION_STORAGE_KEY = 'fyndx-sidebar-logo-animation-page-load'
const SIDEBAR_LOGO_STATIC_SRC = '/assets/fyndx-sidebar-logo.png'
const SIDEBAR_LOGO_ANIMATED_SRC = '/assets/fyndx-sidebar-logo-animated.gif'
let sidebarLogoAnimationPageLoad = ''

function getPageLoadId() {
  if (typeof window === 'undefined') return ''
  const timeOrigin = window.performance?.timeOrigin
  return Number.isFinite(timeOrigin) ? String(timeOrigin) : window.location.href
}

function shouldPlaySidebarLogoAnimation() {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  const pageLoadId = getPageLoadId()
  try {
    return window.sessionStorage.getItem(SIDEBAR_LOGO_ANIMATION_STORAGE_KEY) !== pageLoadId
  } catch {
    return sidebarLogoAnimationPageLoad !== pageLoadId
  }
}

function rememberSidebarLogoAnimation() {
  const pageLoadId = getPageLoadId()
  sidebarLogoAnimationPageLoad = pageLoadId
  try {
    window.sessionStorage.setItem(SIDEBAR_LOGO_ANIMATION_STORAGE_KEY, pageLoadId)
  } catch {
    // The module-level value still prevents replays during this page lifecycle.
  }
}

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
  const location = useLocation()
  const navigate = useNavigate()
  const { isAdmin, isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const pageViews = usePageViewPermissions({ isAdmin, isSuperAdmin })
  const logoAnimationTimerRef = useRef(null)
  const [showAnimatedLogo, setShowAnimatedLogo] = useState(shouldPlaySidebarLogoAnimation)
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

  useEffect(() => {
    if (!showAnimatedLogo) return undefined
    rememberSidebarLogoAnimation()
    return () => {
      if (logoAnimationTimerRef.current !== null) {
        window.clearTimeout(logoAnimationTimerRef.current)
        logoAnimationTimerRef.current = null
      }
    }
  }, [showAnimatedLogo])

  const handleAnimatedLogoLoad = () => {
    if (logoAnimationTimerRef.current !== null) return
    logoAnimationTimerRef.current = window.setTimeout(() => {
      logoAnimationTimerRef.current = null
      setShowAnimatedLogo(false)
    }, SIDEBAR_LOGO_ANIMATION_DURATION_MS)
  }

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

  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-media">
          <img
            src={SIDEBAR_LOGO_STATIC_SRC}
            alt="BridgeX FyndX"
            className={`sidebar-logo-image sidebar-logo-image-static${showAnimatedLogo ? ' is-hidden' : ''}`}
            width="951"
            height="288"
            decoding="async"
            draggable="false"
            onError={() => console.error('BridgeX FyndX sidebar logo failed to load')}
          />
          {showAnimatedLogo && (
            <img
              src={SIDEBAR_LOGO_ANIMATED_SRC}
              alt=""
              aria-hidden="true"
              className="sidebar-logo-image sidebar-logo-image-animated"
              width="475"
              height="144"
              decoding="async"
              draggable="false"
              onLoad={handleAnimatedLogoLoad}
              onError={() => setShowAnimatedLogo(false)}
            />
          )}
        </div>
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
            onPointerDown={(event) => navigateFromPerformancePointer(event, to)}
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
