import { Settings } from 'lucide-react'
import './PlaceholderPage.css'

export default function SettingsPage() {
  return (
    <div className="placeholder-page" id="page-settings">
      <div className="placeholder-icon">
        <Settings size={32} color="var(--gold)" strokeWidth={1.6} />
      </div>
      <h2 className="placeholder-title">Settings</h2>
      <p className="placeholder-desc">
        Configure your workspace preferences, team members, notification rules, and integrations from one central settings hub.
      </p>
      <span className="placeholder-badge">Coming Soon</span>
    </div>
  )
}
