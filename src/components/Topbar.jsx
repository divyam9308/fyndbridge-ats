import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import NotificationBell from './NotificationBell'
import './Topbar.css'

const pageTitles = {
  '/dashboard':            { title: 'Dashboard',   crumb: 'Home / Dashboard' },
  '/dashboard/jobs':       { title: 'Mandates', crumb: 'Home / Mandates' },
  '/dashboard/clients':    { title: 'Clients',     crumb: 'Home / Clients' },
  '/dashboard/candidates': { title: 'Candidates',  crumb: 'Home / Candidates' },
  '/dashboard/performance': { title: 'PMS', crumb: 'Home / PMS' },
  '/dashboard/attendance': { title: 'Attendance', crumb: 'Home / Attendance' },
  '/dashboard/reports/consultant': { title: 'Report', crumb: 'Home / Report' },
  '/dashboard/user-manual': { title: 'User Manual', crumb: 'Home / User Manual' },
  '/dashboard/admin':      { title: 'Admin Panel', crumb: 'Home / Admin Panel' },
  '/dashboard/settings':   { title: 'Settings',    crumb: 'Home / Settings' },
  '/dashboard/profile':    { title: 'Profile Settings', crumb: 'Home / Profile Settings' },
  '/invoice':              { title: 'Invoice',     crumb: 'Home / Invoice' },
}

export default function Topbar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()

  const getPageInfo = (path) => {
    if (pageTitles[path]) return pageTitles[path]
    if (path.startsWith('/dashboard/clients/') && path.endsWith('/candidates')) {
      return { title: 'Client Mandate Candidates', crumb: 'Home / Clients / Client Details / Candidates' }
    }
    if (path.startsWith('/dashboard/clients/')) {
      return { title: 'Client Details', crumb: 'Home / Clients / Client Details' }
    }
    if (path.startsWith('/invoice/entities/')) {
      return { title: 'Entity Details', crumb: 'Home / Invoice / Entity Details' }
    }
    return { title: 'Dashboard', crumb: 'Home / Dashboard' }
  }

  const page = getPageInfo(pathname)
  const displayName = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Recruiter'
  const initials = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">
        <h1 className="topbar-title">{page.title}</h1>
        <div className="topbar-breadcrumb">{page.crumb}</div>
      </div>

      <div className="topbar-right">
        <NotificationBell />
        <span className="topbar-date">{today}</span>
        <button className="topbar-user" type="button" onClick={() => navigate('/dashboard/profile')} aria-label={`Open profile settings for ${displayName}`}>
          <div className="topbar-avatar">{initials || 'HR'}</div>
          <div>
            <div className="topbar-user-name">{displayName}</div>
          </div>
        </button>
      </div>
    </header>
  )
}
