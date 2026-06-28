import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import './DashboardLayout.css'

export default function DashboardLayout() {
  const location = useLocation()
  const contentRef = useRef(null)
  const isDashboardEmbed = new URLSearchParams(location.search).get('embed') === 'dashboard'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    contentRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search])

  if (isDashboardEmbed) {
    return <main ref={contentRef} className="dashboard-content dashboard-embed" key={`${location.pathname}${location.search}`}><Outlet /></main>
  }
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <div className="dashboard-main">
        <Topbar />
        <main ref={contentRef} className="dashboard-content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
