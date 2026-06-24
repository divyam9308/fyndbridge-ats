import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { OnlineUsersProvider } from '../hooks/useOnlineUsers'

const DashboardLayout = lazy(() => import('./DashboardLayout'))
const DashboardHome = lazy(() => import('./DashboardHome'))
const JobsPage = lazy(() => import('./JobsPage'))
const ClientsPage = lazy(() => import('./ClientsPage'))
const ClientDetailPage = lazy(() => import('./ClientDetailPage'))
const ClientJobCandidatesPage = lazy(() => import('./ClientJobCandidatesPage'))
const CandidatesPage = lazy(() => import('./CandidatesPage'))
const AdminPage = lazy(() => import('./AdminPage'))
const SettingsPage = lazy(() => import('./SettingsPage'))
const ProfileSettingsPage = lazy(() => import('./ProfileSettingsPage'))
const InvoicePage = lazy(() => import('./InvoicePage'))

const loading = <div className="route-loading" role="status">Loading...</div>

export default function AuthenticatedApp() {
  return (
    <OnlineUsersProvider>
      <Suspense fallback={loading}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
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
          <Route path="/invoice" element={<DashboardLayout />}>
            <Route index element={<InvoicePage />} />
          </Route>
        </Routes>
      </Suspense>
    </OnlineUsersProvider>
  )
}
