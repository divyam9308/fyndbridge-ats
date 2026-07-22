import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import UpdateAvailable from './components/UpdateAvailable'
import AuthenticatedShellSkeleton from './components/AuthenticatedShellSkeleton'
import { loadAuthenticatedShell } from './utils/routePreload'

let authModuleRequest = null
const loadAuthModule = () => {
  if (!authModuleRequest) authModuleRequest = import('./context/AuthContext')
  return authModuleRequest
}

const AuthProvider = lazy(() => loadAuthModule().then(module => ({ default: module.AuthProvider })))
const RequireAuth = lazy(() => loadAuthModule().then(module => ({ default: module.RequireAuth })))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const PageViewGuard = lazy(() => import('./components/PageViewGuard'))
const AuthenticatedShell = lazy(loadAuthenticatedShell)
const DashboardHome = lazy(() => import('./pages/DashboardHome'))
const JobsPage = lazy(() => import('./pages/JobsPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'))
const ClientJobCandidatesPage = lazy(() => import('./pages/ClientJobCandidatesPage'))
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'))
const PerformanceReviewPage = lazy(() => import('./pages/PerformanceReviewPage'))
const UserManualPage = lazy(() => import('./pages/UserManualPage'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const InvoiceEntityDetailPage = lazy(() => import('./pages/InvoiceEntityDetailPage'))
const AttendancePage = lazy(() => import('./pages/AttendancePage'))
const ConsultantReportPage = lazy(() => import('./pages/ConsultantReportPage'))
const AppliedCandidatesPage = lazy(() => import('./pages/AppliedCandidatesPage'))
const PublicLayout = lazy(() => import('./components/public/PublicLayout'))
const PublicRolesPage = lazy(() => import('./pages/PublicRolesPage'))

function AuthenticatedRoutes() {
  const [aiQuotaNotice, setAiQuotaNotice] = useState('')

  useEffect(() => {
    const showNotice = (event) => {
      setAiQuotaNotice(event.detail || 'AI quota reached')
      window.clearTimeout(showNotice.timer)
      showNotice.timer = window.setTimeout(() => setAiQuotaNotice(''), 10000)
    }

    window.addEventListener('ai-quota-reached', showNotice)
    return () => {
      window.clearTimeout(showNotice.timer)
      window.removeEventListener('ai-quota-reached', showNotice)
    }
  }, [])

  return (
    <Suspense fallback={null}>
      <AuthProvider>
        {aiQuotaNotice && (
          <div className="global-ai-notice" role="status">
            <span>{aiQuotaNotice}</span>
            <button type="button" onClick={() => setAiQuotaNotice('')} aria-label="Close notification">×</button>
          </div>
        )}
        <UpdateAvailable />
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<RequireAuth><Suspense fallback={<AuthenticatedShellSkeleton />}><AuthenticatedShell /></Suspense></RequireAuth>}>
            <Route index element={<PageViewGuard pageKey="dashboard"><DashboardHome /></PageViewGuard>} />
            <Route path="jobs" element={<PageViewGuard pageKey="mandates"><JobsPage /></PageViewGuard>} />
            <Route path="clients" element={<PageViewGuard pageKey="clients"><ClientsPage /></PageViewGuard>} />
            <Route path="clients/:clientId" element={<PageViewGuard pageKey="clients"><ClientDetailPage /></PageViewGuard>} />
            <Route path="clients/:clientId/jobs/:jobId/candidates" element={<PageViewGuard pageKey="clients"><ClientJobCandidatesPage /></PageViewGuard>} />
            <Route path="candidates" element={<PageViewGuard pageKey="candidates"><CandidatesPage /></PageViewGuard>} />
            <Route path="applied-candidates" element={<PageViewGuard pageKey="applied_candidates"><AppliedCandidatesPage /></PageViewGuard>} />
            <Route path="performance" element={<PageViewGuard pageKey="performance_review"><PerformanceReviewPage /></PageViewGuard>} />
            <Route path="attendance" element={<PageViewGuard pageKey="attendance"><AttendancePage /></PageViewGuard>} />
            <Route path="reports/consultant" element={<PageViewGuard pageKey="report"><ConsultantReportPage /></PageViewGuard>} />
            <Route path="user-manual" element={<PageViewGuard pageKey="user_manual"><UserManualPage /></PageViewGuard>} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="cvs" element={<Navigate to="/dashboard/candidates" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
            <Route path="mandates" element={<Navigate to="/dashboard/jobs" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="/invoice" element={<RequireAuth><Suspense fallback={<AuthenticatedShellSkeleton />}><AuthenticatedShell /></Suspense></RequireAuth>}>
            <Route index element={<PageViewGuard pageKey="invoice"><InvoicePage /></PageViewGuard>} />
            <Route path="entities/:entityId" element={<PageViewGuard pageKey="invoice"><InvoiceEntityDetailPage /></PageViewGuard>} />
            <Route path="*" element={<Navigate to="/invoice" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Suspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/open-roles" element={<Suspense fallback={<div className="public-route-loading" role="status">Loading open roles...</div>}><PublicLayout /></Suspense>}>
          <Route index element={<PublicRolesPage />} />
          <Route path=":slug" element={<PublicRolesPage />} />
        </Route>
        <Route path="*" element={<AuthenticatedRoutes />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
