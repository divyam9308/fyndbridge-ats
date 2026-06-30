import { useEffect, useRef, useState } from 'react'
import './UpdateAvailable.css'

const VERSION_URL = '/version.json'
const DEFAULT_CHECK_INTERVAL_MS = 3 * 60 * 1000

function checkIntervalMs() {
  const value = Number(import.meta.env.VITE_VERSION_CHECK_INTERVAL_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CHECK_INTERVAL_MS
}

function readVersion(payload) {
  return String(payload?.version || payload?.generatedAt || '').trim()
}

async function fetchAppVersion() {
  const response = await fetch(`${VERSION_URL}?ts=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) return ''
  return readVersion(await response.json().catch(() => ({})))
}

export default function UpdateAvailable() {
  const initialVersionRef = useRef('')
  const latestVersionRef = useRef('')
  const dismissedVersionRef = useRef('')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (visible) return undefined
    let cancelled = false

    const check = async () => {
      try {
        const version = await fetchAppVersion()
        if (cancelled || !version) return
        if (!initialVersionRef.current) {
          initialVersionRef.current = version
          return
        }
        if (version !== initialVersionRef.current && version !== dismissedVersionRef.current) {
          latestVersionRef.current = version
          setVisible(true)
        }
      } catch {
        // Version checks should never interrupt the app.
      }
    }

    const checkOnVisible = () => {
      if (document.visibilityState === 'visible') check()
    }

    check()
    const interval = window.setInterval(check, checkIntervalMs())
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', checkOnVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', checkOnVisible)
    }
  }, [visible])

  if (!visible) return null

  return (
    <aside className="update-available-toast" role="status" aria-live="polite">
      <div>
        <strong>New version available</strong>
        <span>Reload to use the latest ATS updates.</span>
      </div>
      <div className="update-available-actions">
        <button className="update-available-later" type="button" onClick={() => { dismissedVersionRef.current = latestVersionRef.current; setVisible(false) }}>Later</button>
        <button className="update-available-reload" type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </aside>
  )
}
