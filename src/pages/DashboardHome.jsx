import { LayoutDashboard } from 'lucide-react'
import './PlaceholderPage.css'

export default function DashboardHome() {
  return (
    <div className="placeholder-page" id="page-dashboard">
      <div className="placeholder-icon">
        <LayoutDashboard size={32} color="var(--gold)" strokeWidth={1.6} />
      </div>
      <h2 className="placeholder-title">Dashboard</h2>
      <p className="placeholder-desc">
        Dashboard analytics and reporting features are currently under development and will be available soon.
      </p>
      <span className="placeholder-badge">Coming Soon</span>
    </div>
  )
}
