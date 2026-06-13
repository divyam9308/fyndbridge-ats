import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
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
  const { user } = useAuth()
  const [form, setForm] = useState(EMPTY_PROFILE)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const userId = user?.id || ''
      const email = user?.email || ''
      setForm(current => ({ ...current, user_id: userId, email: current.email || email }))
      if (!userId && !email) return
      try {
        const params = new URLSearchParams({ user_id: userId, email })
        const res = await fetch(`/api/user-profiles?${params.toString()}`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) setForm({ ...EMPTY_PROFILE, user_id: userId, email, ...(data.data || {}) })
      } catch (err) {
        setError(err.message)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user])

  const update = (event) => {
    const { name, value } = event.target
    setForm(current => ({ ...current, [name]: value }))
    setMessage('')
    setError('')
  }

  const save = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch('/api/user-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Unable to save profile.')
      setForm({ ...EMPTY_PROFILE, ...(data.data || {}) })
      setMessage('Profile saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="table-card" style={{ maxWidth: 920 }}>
      <div className="modal-body">
        {error && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
        {message && <div className="sub-text" style={{ marginBottom: 12 }}>{message}</div>}
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
              <input className="form-control" type={type} name={name} value={form[name] || ''} onChange={update} disabled={saving} />
            </div>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn-primary" type="button" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>
      </div>
    </div>
  )
}

