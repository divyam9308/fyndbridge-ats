import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import './DashboardLayout.css'

export default function DashboardLayout() {
  const location = useLocation()
  const isDashboardEmbed = new URLSearchParams(location.search).get('embed') === 'dashboard'
  if (isDashboardEmbed) {
    return <main className="dashboard-content dashboard-embed" key={`${location.pathname}${location.search}`}><Outlet /></main>
  }
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <div className="dashboard-main">
        <Topbar />
        <main className="dashboard-content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
