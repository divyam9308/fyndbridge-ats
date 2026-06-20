import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Briefcase, Building2, Eye, EyeOff, Lock, Mail, Save, Search, Shield, ShieldCheck, Trash2, Unlock, UserPlus, Users, X } from 'lucide-react'
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
  ['clients', 'Clients', Building2],
  ['candidates', 'Candidates', Users],
  ['jobs', 'Mandates', Briefcase]
]

const TYPE_META = {
  Client: { key: 'clients', label: 'Clients', Icon: Building2 },
  Candidate: { key: 'candidates', label: 'Candidates', Icon: Users },
  Mandate: { key: 'jobs', label: 'Mandates', Icon: Briefcase }
}

const PERMISSION_TEXT = {
  everyone: 'Visible and editable by all users',
  admin_disabled: 'Visible but not editable by non-admins',
  admin_hidden: 'Not visible to non-admins'
}

function initials(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'A'
}

function adminName(admin) {
  return admin.name || admin.email?.split('@')[0] || 'Admin'
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isSamePermissions(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {})
}

function changedPermissions(saved, draft) {
  const changes = []
  Object.entries(draft || {}).forEach(([tableName, tablePermissions]) => {
    Object.entries(tablePermissions || {}).forEach(([columnKey, accessMode]) => {
      if ((saved?.[tableName]?.[columnKey] || 'everyone') !== accessMode) {
        changes.push({ tableName, columnKey, accessMode })
      }
    })
  })
  return changes
}

function Section({ title, description, icon: Icon, action, children }) {
  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div className="admin-section-title-wrap">
          <div className="admin-section-icon"><Icon size={21} /></div>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  )
}

function StateChip({ value }) {
  const Icon = value === 'admin_hidden' ? EyeOff : value === 'admin_disabled' ? Lock : Eye
  return (
    <span className={`admin-state-chip is-${value}`}>
      <Icon size={13} />
      {value === 'admin_hidden' ? 'Hidden' : value === 'admin_disabled' ? 'Disabled' : 'Everyone'}
    </span>
  )
}

function LockedRecordsTable({ records, onUnlock, emptyText = 'No records are currently locked.' }) {
  return (
    <div className="admin-lock-table-scroll">
      <table className="admin-lock-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Record</th>
            <th>ID</th>
            <th>Locked By</th>
            <th>Locked Date</th>
            <th className="is-action">Action</th>
          </tr>
        </thead>
        <tbody>
          {records.map(record => {
            const meta = TYPE_META[record.type] || TYPE_META.Client
            const Icon = meta.Icon
            return (
              <tr key={`${record.type}-${record.id}`}>
                <td><span className="admin-type-pill"><Icon size={13} />{record.type}</span></td>
                <td><span className="admin-locked-name"><Lock size={14} />{record.name || '-'}</span></td>
                <td className="admin-mono">{record.displayId || record.id}</td>
                <td>{record.lockedBy || '-'}</td>
                <td>{formatDate(record.lockedAt)}</td>
                <td className="is-action">
                  <button className="admin-unlock-btn" type="button" title="Unlock" onClick={() => onUnlock(record)}>
                    <Unlock size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
          {!records.length && (
            <tr>
              <td colSpan={6} className="admin-empty-row">{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminPage() {
  const { isAdmin, loading, columns, permissions, refresh, setPermissions } = useAdminAccess()
  const [activeTab, setActiveTab] = useState('clients')
  const [admins, setAdmins] = useState([])
  const [email, setEmail] = useState('')
  const [lockedRecords, setLockedRecords] = useState([])
  const [error, setError] = useState('')
  const [columnSearch, setColumnSearch] = useState('')
  const [savedPermissions, setSavedPermissions] = useState({})
  const [draftPermissions, setDraftPermissions] = useState({})
  const [savingPermissions, setSavingPermissions] = useState(false)
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [lockModalType, setLockModalType] = useState('')

  const loadAdminData = useCallback(async () => {
    const [users, locks] = await Promise.all([fetchAdminUsers(), fetchLockedRecords()])
    setAdmins(users.data || [])
    setLockedRecords(locks.data || [])
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedPermissions(permissions || {})
      setDraftPermissions(current => isSamePermissions(current, savedPermissions) || !Object.keys(current || {}).length ? (permissions || {}) : current)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [permissions, savedPermissions])

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
      if (isAdmin) {
        loadAdminData().catch(err => setError(err.message))
        refresh()
      }
    },
    enabled: isAdmin
  })

  const dirty = !isSamePermissions(savedPermissions, draftPermissions)
  const filteredColumns = (columns[activeTab] || []).filter(column => {
    const query = columnSearch.trim().toLowerCase()
    return !query || column.label.toLowerCase().includes(query) || column.key.toLowerCase().includes(query)
  })
  const lockCounts = lockedRecords.reduce((acc, record) => ({ ...acc, [record.type]: (acc[record.type] || 0) + 1 }), {})
  const sortedLocks = [...lockedRecords].sort((a, b) => new Date(b.lockedAt || 0) - new Date(a.lockedAt || 0))
  const limitedLocks = Object.keys(TYPE_META).flatMap(type => sortedLocks.filter(record => record.type === type).slice(0, 2))

  if (loading && !Object.keys(permissions || {}).length) return null
  if (!isAdmin) {
    return (
      <div className="admin-page">
        <section className="admin-section">
          <div className="admin-section-header">
            <div className="admin-section-title-wrap">
              <div className="admin-section-icon"><ShieldCheck size={21} /></div>
              <div>
                <h2>Admin Access Control</h2>
                <p>Admin access could not be confirmed for this session.</p>
              </div>
            </div>
          </div>
          <div className="admin-section-body">
            <div className="admin-error">Sign in with divyam@fyndbridge.in or rajneesh@fyndbridge.in, then refresh this page.</div>
          </div>
        </section>
      </div>
    )
  }

  const setDraftPermission = (tableName, columnKey, accessMode) => {
    setDraftPermissions(current => ({
      ...current,
      [tableName]: { ...(current?.[tableName] || {}), [columnKey]: accessMode }
    }))
  }

  const cancelPermissionChanges = () => {
    setDraftPermissions(savedPermissions)
    setError('')
  }

  const savePermissionChanges = async () => {
    const changes = changedPermissions(savedPermissions, draftPermissions)
    if (!changes.length) return
    setSavingPermissions(true)
    setError('')
    try {
      for (const change of changes) {
        await updateColumnPermission(change.tableName, change.columnKey, change.accessMode)
      }
      setSavedPermissions(draftPermissions)
      setPermissions(draftPermissions)
      await refresh()
    } catch (err) {
      setError(err.message)
      await refresh()
    } finally {
      setSavingPermissions(false)
    }
  }

  const submitAdmin = async (event) => {
    event.preventDefault()
    setError('')
    setSavingAdmin(true)
    try {
      await addAdminUser(email)
      setEmail('')
      await loadAdminData()
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAdmin(false)
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
    const tableName = TYPE_META[record.type]?.key
    if (!tableName) return
    await setRecordLock(tableName, record.id, false)
    await loadAdminData()
  }

  return (
    <div className="admin-page">
      {error && <div className="admin-error">{error}</div>}

      <Section
        title="Admin Access"
        description="Grant or revoke administrator privileges across the workspace."
        icon={ShieldCheck}
        action={<span className="admin-count-pill">{admins.length} active</span>}
      >
        <form className="admin-invite-card" onSubmit={submitAdmin}>
          <div className="admin-email-field">
            <Mail size={17} />
            <input value={email} onChange={event => setEmail(event.target.value)} placeholder="Enter admin email address" />
          </div>
          <button className="admin-add-btn" type="submit" disabled={savingAdmin}>
            <UserPlus size={16} />
            {savingAdmin ? 'Adding...' : 'Add Admin'}
          </button>
          <p>Admins can manage column permissions, lock records, and invite other admins.</p>
        </form>

        <div className="admin-user-grid">
          {admins.map((admin, index) => (
            <div className="admin-user-card" key={admin.email}>
              <div className="admin-avatar">{initials(adminName(admin))}</div>
              <div className="admin-user-main">
                <div className="admin-user-title">
                  <strong>{adminName(admin)}</strong>
                  <span><ShieldCheck size={12} />{index === 0 ? 'Super Admin' : 'Admin'}</span>
                </div>
                <p>{admin.email}</p>
                <small>Added {formatDate(admin.created_at)}</small>
              </div>
              <div className="admin-user-footer">
                <span><i />Active session</span>
                <button type="button" onClick={() => revokeAdmin(admin.email)}><Trash2 size={14} />Revoke</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Column Permissions"
        description="Control how columns appear and behave for non-admin users."
        icon={Shield}
      >
        <div className="admin-permission-toolbar">
          <div className="admin-tabs">
            {TABS.map(([key, label, Icon]) => (
              <button key={key} className={`admin-tab${activeTab === key ? ' is-active' : ''}`} type="button" onClick={() => setActiveTab(key)}>
                <Icon size={15} />{label}
              </button>
            ))}
          </div>
          <label className="admin-column-search">
            <Search size={17} />
            <input value={columnSearch} onChange={event => setColumnSearch(event.target.value)} placeholder="Search columns" />
          </label>
        </div>

        <div className="admin-legend">
          <span className="is-everyone"><i />Everyone</span>
          <span className="is-disabled"><i />Disabled for non-admins</span>
          <span className="is-hidden"><i />Hidden from non-admins</span>
        </div>

        <div className="admin-permission-table">
          <div className="admin-permission-head">
            <span>Column</span>
            <span>Current State</span>
            <span>Access Level</span>
          </div>
          {filteredColumns.map(column => {
            const value = draftPermissions?.[activeTab]?.[column.key] || 'everyone'
            return (
              <div className="admin-permission-row" key={column.key}>
                <div>
                  <div className="admin-permission-label">{column.label}</div>
                  <div className="admin-permission-key">{PERMISSION_TEXT[value]}</div>
                </div>
                <StateChip value={value} />
                <AdminPermissionPicker value={value} onChange={(mode) => setDraftPermission(activeTab, column.key, mode)} />
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title="Record Lock Controls"
        description="Locked records cannot be edited by non-admins until released."
        icon={Lock}
      >
        <div className="admin-lock-summary-grid">
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <button className="admin-lock-summary" type="button" key={type} onClick={() => setLockModalType(type)}>
              <div className="admin-lock-summary-top">
                <span><meta.Icon size={21} /></span>
                <Lock size={17} />
              </div>
              <small>Locked {meta.label}</small>
              <strong>{lockCounts[type] || 0}</strong>
              <em>View locked records →</em>
            </button>
          ))}
        </div>

        <div className="admin-lock-panel">
          <div className="admin-lock-panel-head">
            <h3>Currently locked records</h3>
            <span>{lockedRecords.length} total</span>
          </div>
          <LockedRecordsTable records={limitedLocks} onUnlock={unlockRecord} />
          <div className="admin-more-locks">
            {Object.keys(TYPE_META).map(type => {
              const more = Math.max(0, (lockCounts[type] || 0) - 2)
              return more ? <button type="button" key={type} onClick={() => setLockModalType(type)}>+{more} more {TYPE_META[type].label.toLowerCase()}</button> : null
            })}
          </div>
        </div>
      </Section>

      {dirty && (
        <div className="admin-save-footer">
          <div className="admin-save-footer-inner">
            <span><AlertTriangle size={18} /></span>
            <div>
              <strong>Unsaved permission changes</strong>
              <p>Review your edits and apply them across the workspace.</p>
            </div>
            <button className="admin-footer-cancel" type="button" onClick={cancelPermissionChanges} disabled={savingPermissions}><X size={16} />Cancel</button>
            <button className="admin-footer-save" type="button" onClick={savePermissionChanges} disabled={savingPermissions}><Save size={16} />{savingPermissions ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {lockModalType && createPortal((
        <div className="modal-overlay">
          <div className="modal-card modal-card-lg admin-lock-modal" role="dialog" aria-modal="true" aria-label={`Locked ${TYPE_META[lockModalType]?.label}`}>
            <div className="modal-header">
              <span className="modal-title">Locked {TYPE_META[lockModalType]?.label}</span>
              <button className="modal-close" type="button" onClick={() => setLockModalType('')} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="modal-body">
              <LockedRecordsTable records={sortedLocks.filter(record => record.type === lockModalType)} onUnlock={unlockRecord} />
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
