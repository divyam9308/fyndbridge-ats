import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import './DashboardLayout.css'

export default function DashboardLayout() {
  const location = useLocation()
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
