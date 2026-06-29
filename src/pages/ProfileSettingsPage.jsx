import { CheckCircle2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { apiFetch } from '../services/apiClient'
import '../styles/Shared.css'

const EMPTY_PROFILE = {
  user_id: '',
  name: '',
  email: '',
  gender: '',
  blood_group: '',
  pan: '',
  emergency_mobile_number: '',
  mobile_number: '',
}

export default function ProfileSettingsPage() {
  const { user, session, loading: authLoading, profile, loadProfile, setProfile } = useAuth()
  const [form, setForm] = useState(EMPTY_PROFILE)
  const [originalProfile, setOriginalProfile] = useState(EMPTY_PROFILE)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savedPopup, setSavedPopup] = useState(false)
  const [error, setError] = useState('')

  const baseProfile = useMemo(() => ({
    ...EMPTY_PROFILE,
    user_id: user?.id || '',
    email: user?.email || '',
    name: user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  }), [user])

  useEffect(() => {
    const userId = user?.id || ''
    const email = user?.email || ''
    const fallbackName = user?.profile_name || user?.user_metadata?.full_name || user?.user_metadata?.name || ''
    const nextBase = {
      ...EMPTY_PROFILE,
      user_id: userId,
      email,
      name: fallbackName
    }
    setForm(current => ({ ...nextBase, ...current, user_id: userId, email, name: current.name || fallbackName }))
    setOriginalProfile(current => current.user_id || current.email || current.name ? current : nextBase)
  }, [user])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (authLoading) return
      if (!session || !user?.id) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const data = profile || await loadProfile()
        if (cancelled) return
        const nextProfile = {
          ...baseProfile,
          ...(data || {}),
          user_id: user.id || '',
          email: user.email || ''
        }
        setForm(nextProfile)
        setOriginalProfile(nextProfile)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [authLoading, baseProfile, loadProfile, profile, session, user])

  useEffect(() => {
    if (!savedPopup) return undefined
    const timer = window.setTimeout(() => setSavedPopup(false), 2400)
    return () => window.clearTimeout(timer)
  }, [savedPopup])

  const update = (event) => {
    const { name, value } = event.target
    setForm(current => ({ ...current, [name]: value }))
    setSavedPopup(false)
    setError('')
  }

  const save = async () => {
    setSaving(true)
    setSavedPopup(false)
    setError('')
    try {
      const payload = { ...form, user_id: user?.id || form.user_id, email: user?.email || form.email }
      const res = await apiFetch('/api/user-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to save profile.')
      const nextProfile = { ...EMPTY_PROFILE, ...(data.data || {}), user_id: user?.id || form.user_id, email: user?.email || form.email }
      setForm(nextProfile)
      setOriginalProfile(nextProfile)
      setProfile(null)
      const refreshedProfile = await loadProfile({ force: true })
      const savedName = refreshedProfile?.name || refreshedProfile?.display_name || data.data?.name || ''
      try {
        const current = JSON.parse(window.sessionStorage.getItem('fb_user') || '{}')
        window.sessionStorage.setItem('fb_user', JSON.stringify({ ...current, name: savedName || current.name || '' }))
      } catch {
        // Session storage sync is best-effort.
      }
      window.dispatchEvent(new CustomEvent('fb:profile-name-updated', { detail: savedName }))
      setSavedPopup(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = ['name', 'gender', 'blood_group', 'pan', 'emergency_mobile_number', 'mobile_number']
    .some((key) => String(form[key] || '') !== String(originalProfile[key] || ''))

  return (
    <div className="table-card" style={{ maxWidth: 920 }}>
      <div className={`profile-save-popup-slot${savedPopup ? ' is-visible' : ''}`} aria-live="polite">
        {savedPopup && (
          <div className="profile-save-popup" role="status">
            <CheckCircle2 size={16} strokeWidth={2} />
            <span>Profile saved</span>
          </div>
        )}
      </div>
      <div className="modal-body">
        {error && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
        <div className="form-grid-2">
          {[
            ['name', 'Name', 'text'],
            ['email', 'Email', 'email'],
            ['gender', 'Gender', 'text'],
            ['blood_group', 'Blood Group', 'text'],
            ['pan', 'PAN', 'text'],
            ['mobile_number', 'Mobile Number', 'text'],
            ['emergency_mobile_number', 'Emergency Mobile Number', 'text'],
          ].map(([name, label, type]) => (
            <div className="form-group" key={name}>
              <label className="form-label">{label}</label>
              <input className="form-control" type={type} name={name} value={form[name] || ''} onChange={update} disabled={saving || (name === 'email')} readOnly={name === 'email'} placeholder={loading && name !== 'email' ? 'Loading...' : ''} />
            </div>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn-primary" type="button" onClick={save} disabled={saving || !isDirty}>{saving ? 'Saving...' : 'Save Profile'}</button>
      </div>
    </div>
  )
}
