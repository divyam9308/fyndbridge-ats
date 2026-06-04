import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import DashboardHome from './pages/DashboardHome'
import JobsPage from './pages/JobsPage'
import ClientsPage from './pages/ClientsPage'
import CandidatesPage from './pages/CandidatesPage'
import SettingsPage from './pages/SettingsPage'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardHome />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
