import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import { AuthProvider, RequireAuth } from './context/AuthContext'

const AuthenticatedShell = lazy(() => import('./pages/AuthenticatedShell'))
const DashboardHome = lazy(() => import('./pages/DashboardHome'))
const JobsPage = lazy(() => import('./pages/JobsPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'))
const ClientJobCandidatesPage = lazy(() => import('./pages/ClientJobCandidatesPage'))
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ProfileSettingsPage = lazy(() => import('./pages/ProfileSettingsPage'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const InvoiceEntityDetailPage = lazy(() => import('./pages/InvoiceEntityDetailPage'))

function App() {
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
    <BrowserRouter>
      <AuthProvider>
        {aiQuotaNotice && (
          <div className="global-ai-notice" role="status">
            <span>{aiQuotaNotice}</span>
            <button type="button" onClick={() => setAiQuotaNotice('')} aria-label="Close notification">×</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<RequireAuth><Suspense fallback={<div className="route-loading" role="status">Loading...</div>}><AuthenticatedShell /></Suspense></RequireAuth>}>
            <Route index element={<DashboardHome />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:clientId" element={<ClientDetailPage />} />
            <Route path="clients/:clientId/jobs/:jobId/candidates" element={<ClientJobCandidatesPage />} />
            <Route path="candidates" element={<CandidatesPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="cvs" element={<Navigate to="/dashboard/candidates" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
          </Route>
          <Route path="/invoice" element={<RequireAuth><Suspense fallback={<div className="route-loading" role="status">Loading...</div>}><AuthenticatedShell /></Suspense></RequireAuth>}>
            <Route index element={<InvoicePage />} />
            <Route path="entities/:entityId" element={<InvoiceEntityDetailPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
