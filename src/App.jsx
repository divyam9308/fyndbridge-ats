import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import DashboardHome from './pages/DashboardHome'
import JobsPage from './pages/JobsPage'
import ClientsPage from './pages/ClientsPage'
import ClientDetailPage from './pages/ClientDetailPage'
import ClientJobCandidatesPage from './pages/ClientJobCandidatesPage'
import CandidatesPage from './pages/CandidatesPage'
import SettingsPage from './pages/SettingsPage'
import ProfileSettingsPage from './pages/ProfileSettingsPage'
import { AuthProvider, RequireAuth } from './context/AuthContext'
import './index.css'

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
          <Route path="/dashboard" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
            <Route index element={<DashboardHome />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:clientId" element={<ClientDetailPage />} />
            <Route path="clients/:clientId/jobs/:jobId/candidates" element={<ClientJobCandidatesPage />} />
            <Route path="candidates" element={<CandidatesPage />} />
            <Route path="cvs" element={<Navigate to="/dashboard/candidates" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="profile" element={<ProfileSettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
