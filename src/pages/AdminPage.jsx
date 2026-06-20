import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Trash2, Unlock } from 'lucide-react'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import {
  addAdminUser,
  fetchAdminUsers,
  fetchLockedRecords,
  removeAdminUser,
  updateColumnPermission,
  setRecordLock
} from '../services/adminAccessApi'
import AdminPermissionPicker from '../components/admin/AdminPermissionPicker'
import './AdminPage.css'

const TABS = [
  ['clients', 'Clients'],
  ['candidates', 'Candidates'],
  ['jobs', 'Mandates']
]

function initials(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'A'
}

export default function AdminPage() {
  const { isAdmin, loading, columns, permissions, refresh, setPermissions } = useAdminAccess()
  const [activeTab, setActiveTab] = useState('clients')
  const [admins, setAdmins] = useState([])
  const [email, setEmail] = useState('')
  const [lockedRecords, setLockedRecords] = useState([])
  const [error, setError] = useState('')

  const loadAdminData = useCallback(async () => {
    const [users, locks] = await Promise.all([fetchAdminUsers(), fetchLockedRecords()])
    setAdmins(users.data || [])
    setLockedRecords(locks.data || [])
  }, [])

  useEffect(() => {
    let active = true
    if (isAdmin) {
      Promise.resolve().then(() => {
        if (active) loadAdminData().catch(err => setError(err.message))
      })
    }
    return () => { active = false }
  }, [isAdmin, loadAdminData])

  useRealtimeRefresh({
    channelName: 'realtime:admin-page-locks',
    tables: ['admin_users', 'column_permissions', 'clients', 'candidates', 'jobs'],
    onChange: () => {
      if (isAdmin) loadAdminData().catch(err => setError(err.message))
    },
    enabled: isAdmin
  })

  if (loading) return null
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  const savePermission = async (tableName, columnKey, accessMode) => {
    setError('')
    setPermissions(current => ({
      ...current,
      [tableName]: { ...(current[tableName] || {}), [columnKey]: accessMode }
    }))
    try {
      await updateColumnPermission(tableName, columnKey, accessMode)
      await refresh()
    } catch (err) {
      setError(err.message)
      await refresh()
    }
  }

  const submitAdmin = async (event) => {
    event.preventDefault()
    setError('')
    try {
      await addAdminUser(email)
      setEmail('')
      await loadAdminData()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const revokeAdmin = async (adminEmail) => {
    setError('')
    try {
      await removeAdminUser(adminEmail)
      await loadAdminData()
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const unlockRecord = async (record) => {
    const tableName = record.type === 'Client' ? 'clients' : record.type === 'Candidate' ? 'candidates' : 'jobs'
    await setRecordLock(tableName, record.id, false)
    await loadAdminData()
  }

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <h1>Admin Access Control</h1>
        <p>Manage admin users, field visibility, edit restrictions, and locked records.</p>
      </header>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-card">
        <h2>Admin Access</h2>
        <p className="admin-card-subtitle">Only admins can add or revoke admin access.</p>
        <form className="admin-form-row" onSubmit={submitAdmin}>
          <input className="form-control" value={email} onChange={event => setEmail(event.target.value)} placeholder="admin@fyndbridge.in" />
          <button className="btn-primary" type="submit">Add Admin</button>
        </form>
        <div className="admin-users">
          {admins.map(admin => (
            <div className="admin-user-card" key={admin.email}>
              <div className="admin-avatar">{initials(admin.name || admin.email)}</div>
              <div className="admin-user-meta">
                <div className="admin-user-name">{admin.name || admin.email.split('@')[0]}</div>
                <div className="admin-user-email">{admin.email}</div>
              </div>
              <button className="row-action-btn" type="button" title="Revoke admin" onClick={() => revokeAdmin(admin.email)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-card">
        <h2>Column Permissions</h2>
        <p className="admin-card-subtitle">Everyone can view/edit, Admin Disabled is view-only for non-admins, Admin Hidden is hidden for non-admins.</p>
        <div className="admin-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`admin-tab${activeTab === key ? ' is-active' : ''}`} type="button" onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>
        {(columns[activeTab] || []).map(column => (
          <div className="admin-permission-row" key={column.key}>
            <div>
              <div className="admin-permission-label">{column.label}</div>
              <div className="admin-permission-key">{column.key}</div>
            </div>
            <AdminPermissionPicker value={permissions?.[activeTab]?.[column.key] || 'everyone'} onChange={(mode) => savePermission(activeTab, column.key, mode)} />
          </div>
        ))}
      </section>

      <section className="admin-card">
        <h2>Record Lock Controls</h2>
        <p className="admin-card-subtitle">Unlock records currently locked from non-admin edits.</p>
        {lockedRecords.length ? lockedRecords.map(record => (
          <div className="admin-lock-row" key={`${record.type}-${record.id}`}>
            <div>
              <div className="admin-permission-label">{record.type}: {record.name || '-'}</div>
              <div className="admin-permission-key">{record.displayId || record.id}</div>
            </div>
            <button className="row-action-btn" type="button" title="Unlock record" onClick={() => unlockRecord(record)}><Unlock size={13} /></button>
          </div>
        )) : <p className="admin-card-subtitle">No locked records.</p>}
      </section>
    </div>
  )
}
