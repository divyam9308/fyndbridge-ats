import { Outlet } from 'react-router-dom'
import '../../pages/PublicRolesPage.css'

export default function PublicLayout() {
  return (
    <div className="public-careers-layout">
      <main className="public-careers-main">
        <Outlet />
      </main>
    </div>
  )
}
