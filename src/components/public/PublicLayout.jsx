import { Outlet } from 'react-router-dom'
import '../../pages/PublicRolesPage.css'

export default function PublicLayout() {
  return (
    <div className="public-careers-layout">
      <header className="public-careers-header">
        <a className="public-careers-brand" href="/open-roles" aria-label="FyndBridge Open Roles home">
          <picture>
            <source srcSet="/assets/fyndbridge-official-logo-380.webp 380w, /assets/fyndbridge-official-logo.webp 543w" type="image/webp" />
            <img src="/assets/fyndbridge-official-logo.png" alt="FyndBridge" width="190" height="72" />
          </picture>
        </a>
        <span>Careers</span>
      </header>
      <main className="public-careers-main">
        <Outlet />
      </main>
      <footer className="public-careers-footer">
        <span>FyndBridge Consultants &amp; Advisors</span>
        <span>Equal opportunities. Exceptional careers.</span>
      </footer>
    </div>
  )
}
