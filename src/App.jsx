import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import { AuthProvider, RequireAuth } from './context/AuthContext'

const AuthenticatedApp = lazy(() => import('./pages/AuthenticatedApp'))

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
          <Route path="/dashboard/*" element={<RequireAuth><Suspense fallback={<div className="route-loading" role="status">Loading...</div>}><AuthenticatedApp /></Suspense></RequireAuth>} />
          <Route path="/invoice" element={<RequireAuth><Suspense fallback={<div className="route-loading" role="status">Loading...</div>}><AuthenticatedApp /></Suspense></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
