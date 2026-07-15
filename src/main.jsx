import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { installApiFetchInterceptor } from './services/apiClient'

installApiFetchInterceptor()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <SpeedInsights />
    </AppErrorBoundary>
  </StrictMode>,
)
