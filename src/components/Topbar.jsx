import { useLocation } from 'react-router-dom'
import './Topbar.css'

const pageTitles = {
  '/dashboard':            { title: 'Dashboard',   crumb: 'Home / Dashboard' },
  '/dashboard/jobs':       { title: 'Jobs',        crumb: 'Home / Jobs' },
  '/dashboard/clients':    { title: 'Clients',     crumb: 'Home / Clients' },
  '/dashboard/candidates': { title: 'Candidates',  crumb: 'Home / Candidates' },
  '/dashboard/settings':   { title: 'Settings',    crumb: 'Home / Settings' },
}

export default function Topbar() {
  const { pathname } = useLocation()
  const page = pageTitles[pathname] || { title: 'Dashboard', crumb: 'Home / Dashboard' }

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
        <div className="topbar-user" aria-label="Logged in as Sarah Mehta">
          <div className="topbar-avatar">SM</div>
          <div>
            <div className="topbar-user-name">Sarah Mehta</div>
            <div className="topbar-user-role">HR Recruiter</div>
          </div>
        </div>
      </div>
    </header>
  )
}
