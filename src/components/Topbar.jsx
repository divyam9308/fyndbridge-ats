import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import './Topbar.css'

const pageTitles = {
  '/dashboard':            { title: 'Dashboard',   crumb: 'Home / Dashboard' },
  '/dashboard/jobs':       { title: 'Mandates', crumb: 'Home / Mandates' },
  '/dashboard/clients':    { title: 'Clients',     crumb: 'Home / Clients' },
  '/dashboard/candidates': { title: 'Candidates',  crumb: 'Home / Candidates' },
  '/dashboard/settings':   { title: 'Settings',    crumb: 'Home / Settings' },
}

export default function Topbar() {
  const { pathname } = useLocation()
  const { user } = useAuth()

  const getPageInfo = (path) => {
    if (pageTitles[path]) return pageTitles[path]
    if (path.startsWith('/dashboard/clients/') && path.endsWith('/candidates')) {
      return { title: 'Client Mandate Candidates', crumb: 'Home / Clients / Client Details / Candidates' }
    }
    if (path.startsWith('/dashboard/clients/')) {
      return { title: 'Client Details', crumb: 'Home / Clients / Client Details' }
    }
    return { title: 'Dashboard', crumb: 'Home / Dashboard' }
  }

  const page = getPageInfo(pathname)
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Recruiter'
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
        <span className="topbar-date">{today}</span>
        <div className="topbar-user" aria-label={`Logged in as ${displayName}`}>
          <div className="topbar-avatar">{initials || 'HR'}</div>
          <div>
            <div className="topbar-user-name">{displayName}</div>
            <div className="topbar-user-role">HR Recruiter</div>
          </div>
        </div>
      </div>
    </header>
  )
}
