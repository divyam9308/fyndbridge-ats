import { Component } from 'react'
import './AppErrorBoundary.css'

const RECOVERY_STORAGE_KEY = 'fb:automatic-app-recovery-at'
const RECOVERY_COOLDOWN_MS = 30 * 1000

function isRecoverableAssetError(error) {
  const message = String(error?.message || error || '')
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|Loading CSS chunk|error loading dynamically imported module/i.test(message)
}

function recoveryUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('__fb_refresh', Date.now().toString())
  return url.toString()
}

function lastAutomaticRecovery() {
  try { return Number(window.sessionStorage.getItem(RECOVERY_STORAGE_KEY)) || 0 } catch { return 0 }
}

function recordAutomaticRecovery() {
  try { window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, Date.now().toString()) } catch {
    // Recovery still works when browser storage is unavailable.
  }
}

export default class AppErrorBoundary extends Component {
  state = { error: null, recovering: false }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ATS] Application error', error, info)
    if (!isRecoverableAssetError(error) || Date.now() - lastAutomaticRecovery() < RECOVERY_COOLDOWN_MS) return
    recordAutomaticRecovery()
    this.setState({ recovering: true })
    window.location.replace(recoveryUrl())
  }

  reload = () => {
    window.location.replace(recoveryUrl())
  }

  openDashboard = () => {
    window.location.assign('/dashboard')
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="app-recovery" role="alert">
        <section className="app-recovery-card">
          <div className="app-recovery-mark">FB</div>
          <p className="app-recovery-eyebrow">Fyndbridge ATS</p>
          <h1>{this.state.recovering ? 'Refreshing the ATS…' : 'The page could not be displayed'}</h1>
          <p>{this.state.recovering ? 'A newer application version was detected. This page will reopen automatically.' : 'Your data is safe. Reload the application or return to the dashboard.'}</p>
          {!this.state.recovering && <div className="app-recovery-actions"><button type="button" onClick={this.reload}>Reload ATS</button><button type="button" className="is-secondary" onClick={this.openDashboard}>Open Dashboard</button></div>}
        </section>
      </main>
    )
  }
}
