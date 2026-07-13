import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import { useAuth } from '../context/useAuth'
import './DashboardLayout.css'

export default function DashboardLayout() {
  const location = useLocation()
  const { employmentStatus } = useAuth()
  const contentRef = useRef(null)
  const isDashboardEmbed = new URLSearchParams(location.search).get('embed') === 'dashboard'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    contentRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search])

  if (isDashboardEmbed) {
    return <main ref={contentRef} className="dashboard-content dashboard-embed" key={`${location.pathname}${location.search}`}>{employmentStatus === 'on_leave' && <div className="employment-on-leave-banner" role="status">You are currently marked On Leave and cannot receive new assignments.</div>}<Outlet /></main>
  }
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <div className="dashboard-main">
        <Topbar />
        {employmentStatus === 'on_leave' && <div className="employment-on-leave-banner" role="status">You are currently marked On Leave and cannot receive new assignments.</div>}
        <main ref={contentRef} className="dashboard-content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
