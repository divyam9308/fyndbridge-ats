import './Sidebar.css'
import '../pages/DashboardLayout.css'

const NAV_SKELETON_COUNT = 9

export default function AuthenticatedShellSkeleton() {
  return <div className="dashboard-layout auth-shell-skeleton" aria-busy="true" aria-label="Loading application">
    <aside className="sidebar" aria-hidden="true">
      <div className="sidebar-logo"><span className="auth-shell-skeleton-logo" /></div>
      <nav className="sidebar-nav">{Array.from({ length: NAV_SKELETON_COUNT }, (_, index) => <span className="auth-shell-skeleton-nav" key={index} />)}</nav>
      <div className="sidebar-bottom"><span className="auth-shell-skeleton-user" /><span className="auth-shell-skeleton-logout" /></div>
    </aside>
    <div className="dashboard-main">
      <header className="topbar"><span className="auth-shell-skeleton-title" /><span className="auth-shell-skeleton-avatar" /></header>
      <main className="dashboard-content auth-shell-skeleton-content"><span className="auth-shell-skeleton-heading" /><span className="auth-shell-skeleton-subheading" /><div className="auth-shell-skeleton-cards"><span /><span /><span /></div><span className="auth-shell-skeleton-panel" /></main>
    </div>
  </div>
}
