import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, Briefcase, Building2, Eye, EyeOff, Lock, Save, Search, Shield, ShieldCheck, Trash2, Unlock, UserPlus, Users, X } from 'lucide-react'
import { notifyAdminPermissionsChanged, useAdminAccess } from '../hooks/useAdminAccess'
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh'
import {
  addAdminUser,
  fetchAdminBootstrap,
  fetchLockedRecords,
  removeAdminUser,
  updateAdminUserRole,
  updateColumnPermission,
  setRecordLock,
  updatePageViewPermission
  ,updateDashboardVisibility
} from '../services/adminAccessApi'
import AdminPermissionPicker from '../components/admin/AdminPermissionPicker'
import PageViewPermissions from '../components/admin/PageViewPermissions'
import {
  PERFORMANCE_COLUMNS,
  PERFORMANCE_PERMISSION_OPTIONS,
  PERFORMANCE_TABLE_KEY,
  DEFAULT_PERFORMANCE_PERMISSIONS
} from '../utils/performanceReviewStorage'
import { savePerformancePermissions } from '../services/performanceApi'
import { setPageViewPermissions, usePageViewPermissions } from '../hooks/usePageViewPermissions'
import { PAGE_VIEW_DEFAULTS } from '../utils/pageViewPermissions'
import './AdminPage.css'
import AttendancePermissionSettings from '../features/attendance/AttendancePermissionSettings'
import EmployeeManagement from '../features/employee-management/EmployeeManagement'
import { loadAttendancePermissions, saveAttendancePermissions } from '../utils/attendancePermissionStorage'
import { getAttendancePermissions, updateAttendancePermissions } from '../services/attendanceApi'

const TABS = [
  ['clients', 'Clients', Building2],
  ['candidates', 'Candidates', Users],
  ['jobs', 'Mandates', Briefcase]
]

const PERFORMANCE_TAB = [PERFORMANCE_TABLE_KEY, 'Performance', BarChart3]

const TYPE_META = {
  Client: { key: 'clients', label: 'Clients', Icon: Building2 },
  Candidate: { key: 'candidates', label: 'Candidates', Icon: Users },
  Mandate: { key: 'jobs', label: 'Mandates', Icon: Briefcase }
}

const PERMISSION_TEXT = {
  everyone: 'Visible and editable by all users',
  admin_disabled: 'Visible but not editable by non-admins',
  admin_hidden: 'Not visible to non-admins',
  super_admin_disabled: 'Visible but editable only by Super Admins',
  super_admin_hidden: 'Not visible to non-super-admins'
}

const PERFORMANCE_PICKER_OPTIONS = PERFORMANCE_PERMISSION_OPTIONS.map(option => ({
  ...option,
  Icon: option.value === 'everyone' ? Eye : option.value === 'super_admin_disabled' ? Lock : EyeOff
}))

function initials(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'A'
}

function adminName(admin) {
  return admin.name || admin.email?.split('@')[0] || 'Admin'
}

function adminIsSuper(admin) {
  return admin?.role === 'super_admin' || Boolean(admin?.is_super_admin || admin?.isSuperAdmin)
}

function adminRoleLabel(admin) {
  return adminIsSuper(admin) ? 'Super Admin' : 'Admin'
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
    if (tableName === PERFORMANCE_TABLE_KEY) return
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

function AdminSkeletonBlock({ className = '' }) {
  return <span className={`admin-skeleton-block ${className}`} aria-hidden="true" />
}

function AdminLoadingShell() {
  return (
    <div className="admin-page">
      <section className="admin-section admin-section-skeleton">
        <div className="admin-section-header">
          <div className="admin-section-title-wrap">
            <div className="admin-section-icon"><ShieldCheck size={21} /></div>
            <div>
              <AdminSkeletonBlock className="is-title" />
              <AdminSkeletonBlock className="is-copy" />
            </div>
          </div>
          <AdminSkeletonBlock className="is-pill" />
        </div>
        <div className="admin-section-body">
          <div className="admin-invite-card admin-loading-card">
            <AdminSkeletonBlock className="is-input" />
            <AdminSkeletonBlock className="is-button" />
            <AdminSkeletonBlock className="is-copy-wide" />
          </div>
          <div className="admin-advanced-card">
            <div>
              <AdminSkeletonBlock className="is-heading" />
              <AdminSkeletonBlock className="is-copy" />
            </div>
            <AdminSkeletonBlock className="is-control" />
            <AdminSkeletonBlock className="is-copy-wide" />
          </div>
          <div className="admin-user-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="admin-user-card admin-loading-user" key={index}>
                <AdminSkeletonBlock className="is-avatar" />
                <AdminSkeletonBlock className="is-heading" />
                <AdminSkeletonBlock className="is-copy" />
                <AdminSkeletonBlock className="is-footer" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function StateChip({ value }) {
  const Icon = value.includes('hidden') ? EyeOff : value.includes('disabled') ? Lock : Eye
  const className = value === 'everyone' ? 'is-everyone' : `is-${value}`
  return (
    <span className={`admin-state-chip ${className}`}>
      <Icon size={13} />
      {value.includes('hidden') ? 'Hidden' : value.includes('disabled') ? 'Disabled' : 'Everyone'}
    </span>
  )
}

function PerformancePermissionBadge({ value }) {
  return <span className={`admin-performance-permission-badge is-${value}`}>{PERMISSION_TEXT[value] || value}</span>
}

function PerformanceCalculatedPermissionPicker({ value, onChange }) {
  const hidden = value === 'super_admin_hidden'
  return (
    <div className="admin-calculated-permission-picker">
      <button className="admin-calculated-option is-active" type="button" disabled>
        <Lock size={13} />
        <span>Calculated · always read-only</span>
      </button>
      <button className={`admin-calculated-option${hidden ? ' is-hidden-active' : ''}`} type="button" onClick={() => onChange(hidden ? 'everyone' : 'super_admin_hidden')}>
        <EyeOff size={13} />
        <span>Super Admin Hidden</span>
      </button>
    </div>
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
                <td>{record.lockedBy ? (record.lockedByName || 'Unknown user') : '-'}</td>
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
  const navigate = useNavigate()
  const { isAdmin, isSuperAdmin, loading, columns, permissions, refresh, refreshPermissions, setPermissions } = useAdminAccess()
  const hadAdminAccessRef = useRef(false)
  const [activeTab, setActiveTab] = useState('clients')
  const [admins, setAdmins] = useState([])
  const [profiles, setProfiles] = useState([])
  const [profileQuery, setProfileQuery] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [selectedAdminEmail, setSelectedAdminEmail] = useState('')
  const [lockedRecords, setLockedRecords] = useState([])
  const [error, setError] = useState('')
  const [columnSearch, setColumnSearch] = useState('')
  const [savedPermissions, setSavedPermissions] = useState({})
  const [draftPermissions, setDraftPermissions] = useState({})
  const [savingPermissions, setSavingPermissions] = useState(false)
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [savingRole, setSavingRole] = useState(false)
  const [lockModalType, setLockModalType] = useState('')
  const [dashboardRestricted, setDashboardRestricted] = useState(true)
  const [savedDashboardRestricted, setSavedDashboardRestricted] = useState(true)
  const [performancePermissions, setPerformancePermissions] = useState(DEFAULT_PERFORMANCE_PERMISSIONS)
  const { permissions: pageViewPermissions, loading: pageViewPermissionsLoading } = usePageViewPermissions()
  const [savedPageViewPermissions, setSavedPageViewPermissions] = useState(() => ({ ...PAGE_VIEW_DEFAULTS }))
  const [draftPageViewPermissions, setDraftPageViewPermissions] = useState(() => ({ ...PAGE_VIEW_DEFAULTS }))
  const [savedAttendancePermissions, setSavedAttendancePermissions] = useState(() => loadAttendancePermissions())
  const [draftAttendancePermissions, setDraftAttendancePermissions] = useState(() => loadAttendancePermissions())
  const [employeeManagementDirty, setEmployeeManagementDirty] = useState(false)
  const profilePickerRef = useRef(null)
  const employeeManagementRef = useRef(null)

  const loadAdminData = useCallback(async () => {
    const bootstrap = await fetchAdminBootstrap()
    const data = bootstrap.data || {}
    setAdmins(data.admins || [])
    setLockedRecords(data.lockedRecords || [])
    setProfiles(data.profileOptions || [])
    const value = data.dashboardVisibility?.restrictNonAdminToSelf !== false
    setDashboardRestricted(value)
    setSavedDashboardRestricted(value)
    if (data.performancePermissions) {
      setPerformancePermissions({ ...DEFAULT_PERFORMANCE_PERMISSIONS, ...data.performancePermissions })
    }
  }, [])

  const loadLockedRecords = useCallback(async () => {
    const locks = await fetchLockedRecords()
    setLockedRecords(locks.data || [])
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedPermissions(currentSaved => {
        const nextSaved = { ...(permissions || {}) }
        if (isSuperAdmin) nextSaved[PERFORMANCE_TABLE_KEY] = performancePermissions
        setDraftPermissions(currentDraft => isSamePermissions(currentDraft, currentSaved) || !Object.keys(currentDraft || {}).length ? nextSaved : currentDraft)
        return nextSaved
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [isSuperAdmin, performancePermissions, permissions])

  useEffect(() => {
    if (pageViewPermissionsLoading) return
    const timer = window.setTimeout(() => {
      setSavedPageViewPermissions(currentSaved => {
        const nextSaved = { ...(pageViewPermissions || {}) }
        setDraftPageViewPermissions(currentDraft => isSamePermissions(currentDraft, currentSaved) || !Object.keys(currentDraft || {}).length ? nextSaved : currentDraft)
        return nextSaved
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pageViewPermissions, pageViewPermissionsLoading])

  useEffect(() => {
    let active = true
    if (isAdmin) {
      Promise.resolve().then(() => {
        if (active) loadAdminData().catch(err => setError(err.message))
      })
    }
    return () => { active = false }
  }, [isAdmin, loadAdminData])

  useEffect(() => {
    if (!isAdmin) return
    getAttendancePermissions().then(value => {
      setSavedAttendancePermissions(value)
      setDraftAttendancePermissions(value)
      saveAttendancePermissions(value)
    }).catch(err => setError(err.message))
  }, [isAdmin])

  useEffect(() => {
    if (!profileOpen) return undefined
    const close = (event) => {
      if (!profilePickerRef.current?.contains(event.target)) setProfileOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [profileOpen])

  useEffect(() => {
    if (loading) return
    if (isAdmin) {
      hadAdminAccessRef.current = true
    } else if (hadAdminAccessRef.current) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAdmin, loading, navigate])

  useRealtimeRefresh({
    channelName: 'realtime:admin-page-admin-users',
    tables: ['admin_users'],
    onChange: () => {
      if (isAdmin) {
        loadAdminData().catch(err => setError(err.message))
      }
    },
    enabled: isAdmin
  })

  useRealtimeRefresh({
    channelName: 'realtime:admin-page-locks',
    tables: ['clients', 'candidates', 'jobs'],
    onChange: () => {
      if (isAdmin) loadLockedRecords().catch(err => setError(err.message))
    },
    enabled: isAdmin
  })

  const dashboardVisibilityDirty = dashboardRestricted !== savedDashboardRestricted
  const pageViewPermissionsDirty = !isSamePermissions(savedPageViewPermissions, draftPageViewPermissions)
  const attendancePermissionsDirty = !isSamePermissions(savedAttendancePermissions, draftAttendancePermissions)
  const permissionChangesDirty = !isSamePermissions(savedPermissions, draftPermissions) || dashboardVisibilityDirty || pageViewPermissionsDirty || attendancePermissionsDirty
  const dirty = permissionChangesDirty || employeeManagementDirty
  const availableTabs = isSuperAdmin ? [...TABS, PERFORMANCE_TAB] : TABS
  const columnSource = activeTab === PERFORMANCE_TABLE_KEY ? PERFORMANCE_COLUMNS : (columns[activeTab] || [])
  const filteredColumns = columnSource.filter(column => {
    const query = columnSearch.trim().toLowerCase()
    return !query || column.label.toLowerCase().includes(query) || column.key.toLowerCase().includes(query)
  })
  const lockCounts = lockedRecords.reduce((acc, record) => ({ ...acc, [record.type]: (acc[record.type] || 0) + 1 }), {})
  const sortedLocks = [...lockedRecords].sort((a, b) => new Date(b.lockedAt || 0) - new Date(a.lockedAt || 0))
  const limitedLocks = Object.keys(TYPE_META).flatMap(type => sortedLocks.filter(record => record.type === type).slice(0, 2))
  const superAdminCount = admins.filter(adminIsSuper).length
  const selectedAdmin = admins.find(admin => admin.email === selectedAdminEmail) || admins[0]
  const currentAdmin = admins.find(admin => admin.is_current_user)
  const selectedIsSuper = adminIsSuper(selectedAdmin)
  const roleTarget = selectedIsSuper ? 'admin' : 'super_admin'
  const selectedIsLastSuper = selectedIsSuper && superAdminCount <= 1
  const selectedIsCurrentUser = Boolean(selectedAdmin?.is_current_user)
  const roleActionDisabled = !isSuperAdmin || !selectedAdmin || selectedIsCurrentUser || selectedIsLastSuper || savingRole
  const selectedProfile = profiles.find((profile) => profile.user_id === selectedProfileId)
  const profileMatches = profiles.filter((profile) => {
    const query = profileQuery.trim().toLowerCase()
    return !query || profile.name.toLowerCase().includes(query) || profile.email.toLowerCase().includes(query)
  }).filter((profile) => !admins.some((admin) => admin.email === profile.email))

  if (loading) {
    return <AdminLoadingShell />
  }
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
            <div className="admin-error">Your email is not listed as an admin in Supabase.</div>
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
    setDraftPageViewPermissions(savedPageViewPermissions)
    setDraftAttendancePermissions(savedAttendancePermissions)
    setDashboardRestricted(savedDashboardRestricted)
    employeeManagementRef.current?.cancelChanges()
    setError('')
  }

  const savePermissionChanges = async () => {
    const changes = changedPermissions(savedPermissions, draftPermissions)
    const performanceChanged = isSuperAdmin && !isSamePermissions(savedPermissions?.[PERFORMANCE_TABLE_KEY], draftPermissions?.[PERFORMANCE_TABLE_KEY])
    const pageViewChanges = Object.entries(draftPageViewPermissions).filter(([pageKey, viewPermission]) => savedPageViewPermissions?.[pageKey] !== viewPermission)
    if (!changes.length && !dashboardVisibilityDirty && !performanceChanged && !pageViewChanges.length && !attendancePermissionsDirty && !employeeManagementDirty) return
    setSavingPermissions(true)
    setError('')
    try {
      for (const change of changes) {
        await updateColumnPermission(change.tableName, change.columnKey, change.accessMode)
      }
      if (dashboardVisibilityDirty) {
        const data = await updateDashboardVisibility(dashboardRestricted)
        const value = data.restrictNonAdminToSelf !== false
        setDashboardRestricted(value)
        setSavedDashboardRestricted(value)
      }
      if (performanceChanged) {
        const data = await savePerformancePermissions(draftPermissions?.[PERFORMANCE_TABLE_KEY])
        setPerformancePermissions({ ...DEFAULT_PERFORMANCE_PERMISSIONS, ...(data.permissions || {}) })
        window.dispatchEvent(new Event('fb:performance-permissions-changed'))
      }
      let nextPageViewPermissions = null
      for (const [pageKey, viewPermission] of pageViewChanges) {
        const result = await updatePageViewPermission(pageKey, viewPermission)
        nextPageViewPermissions = result.permissions || nextPageViewPermissions
      }
      if (nextPageViewPermissions) {
        setPageViewPermissions(nextPageViewPermissions)
        setSavedPageViewPermissions(nextPageViewPermissions)
        setDraftPageViewPermissions(nextPageViewPermissions)
      }
      if (attendancePermissionsDirty) {
        const persisted = await updateAttendancePermissions(draftAttendancePermissions)
        saveAttendancePermissions(persisted)
        setDraftAttendancePermissions(persisted)
        setSavedAttendancePermissions(persisted)
      }
      if (permissionChangesDirty) {
        setSavedPermissions(draftPermissions)
        setPermissions(draftPermissions)
        await refreshPermissions()
        notifyAdminPermissionsChanged()
      }
      await employeeManagementRef.current?.saveChanges()
    } catch (err) {
      setError(err.message)
      if (permissionChangesDirty) await refreshPermissions().catch(() => null)
    } finally {
      setSavingPermissions(false)
    }
  }

  const submitAdmin = async (event) => {
    event.preventDefault()
    if (!selectedProfile) return
    setError('')
    setSavingAdmin(true)
    try {
      await addAdminUser(selectedProfile.user_id, 'admin')
      setProfileQuery('')
      setSelectedProfileId('')
      await loadAdminData()
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAdmin(false)
    }
  }

  const changeAdminRole = async () => {
    if (!selectedAdmin) return
    const action = roleTarget === 'super_admin' ? 'Promote' : 'Demote'
    if (!window.confirm(`${action} ${adminName(selectedAdmin)}?`)) return
    setError('')
    setSavingRole(true)
    try {
      await updateAdminUserRole(selectedAdmin.email, roleTarget)
      await loadAdminData()
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingRole(false)
    }
  }

  const revokeAdmin = async (adminEmail) => {
    const target = admins.find(admin => admin.email === adminEmail)
    if (target && !window.confirm(`Revoke ${adminName(target)}?`)) return
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
    await loadLockedRecords()
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
          <div className="admin-profile-picker" ref={profilePickerRef}>
            <div className="admin-email-field">
              <Search size={17} />
              <input value={profileQuery} onFocus={() => setProfileOpen(true)} onChange={event => { setProfileQuery(event.target.value); setSelectedProfileId(''); setProfileOpen(true) }} placeholder="Enter name" disabled={!isSuperAdmin} role="combobox" aria-expanded={profileOpen} aria-controls="admin-profile-options" />
            </div>
            {profileOpen ? <div className="admin-profile-options" id="admin-profile-options" role="listbox">
              {profileMatches.length ? profileMatches.map((profile) => <button type="button" role="option" key={profile.user_id} onClick={() => { setSelectedProfileId(profile.user_id); setProfileQuery(profile.name); setProfileOpen(false) }}><strong>{profile.name}</strong><small>{profile.email}</small></button>) : <span>No eligible saved profiles found.</span>}
            </div> : null}
          </div>
          <button className="admin-add-btn" type="submit" disabled={savingAdmin || !isSuperAdmin || !selectedProfile}>
            <UserPlus size={16} />
            {savingAdmin ? 'Adding...' : 'Add Admin'}
          </button>
          <p>{isSuperAdmin ? 'Choose a saved profile to grant Admin access.' : 'Super Admin required to add or change admin users.'}</p>
        </form>

        <div className="admin-advanced-card">
          <div>
            <h3>Advanced role management</h3>
            <p>Promote an existing admin to Super Admin or demote a Super Admin safely.</p>
          </div>
          <div className="admin-role-controls">
            <select value={selectedAdmin?.email || ''} onChange={event => setSelectedAdminEmail(event.target.value)} disabled={!admins.length}>
              {admins.map(admin => <option key={admin.email} value={admin.email}>{adminName(admin)} - {admin.email}</option>)}
            </select>
            <span className={`admin-role-current${selectedIsSuper ? ' is-super' : ''}`}>{selectedAdmin ? adminRoleLabel(selectedAdmin) : '-'}</span>
            <button className="admin-role-btn" type="button" onClick={changeAdminRole} disabled={roleActionDisabled} title={!isSuperAdmin ? 'Super Admin required.' : selectedIsCurrentUser ? 'You cannot revoke your own access.' : selectedIsLastSuper ? 'At least one Super Admin must remain.' : ''}>
              <ShieldCheck size={15} />
              {savingRole ? 'Saving...' : selectedIsSuper ? 'Demote to Admin' : 'Promote to Super Admin'}
            </button>
          </div>
          <small>{selectedIsCurrentUser ? 'You cannot revoke your own access.' : selectedIsLastSuper ? 'At least one Super Admin must remain.' : !isSuperAdmin ? 'Super Admin required.' : 'Role changes apply immediately.'}</small>
        </div>

        <div className="admin-user-grid">
          {admins.map((admin) => {
            const superAdmin = adminIsSuper(admin)
            const isSelf = admin.is_current_user || currentAdmin?.email === admin.email
            const lastSuper = superAdmin && superAdminCount <= 1
            const canRevoke = isSuperAdmin && !isSelf && !lastSuper
            const revokeTitle = isSelf ? 'You cannot revoke your own access.' : !isSuperAdmin ? 'Super Admin required.' : lastSuper ? 'At least one Super Admin must remain.' : 'Revoke'
            return (
            <div className={`admin-user-card${superAdmin ? ' is-super' : ''}`} key={admin.email}>
              <div className="admin-avatar">{initials(adminName(admin))}</div>
              <div className="admin-user-main">
                <div className="admin-user-title">
                  <strong>{adminName(admin)}</strong>
                  <span className={superAdmin ? 'is-super' : ''}><ShieldCheck size={12} />{adminRoleLabel(admin)}</span>
                </div>
                <p>{admin.email}</p>
                <small>Added {formatDate(admin.created_at)}</small>
              </div>
              <div className="admin-user-footer">
                <span><i />Active session</span>
                <button type="button" onClick={() => revokeAdmin(admin.email)} disabled={!canRevoke} title={revokeTitle}><Trash2 size={14} />Revoke</button>
              </div>
            </div>
          )})}
        </div>
      </Section>

      <Section title="Dashboard Consultant Visibility" description="Control whether non-admin users can view only their own dashboard." icon={Shield}>
        <div className="admin-advanced-card admin-dashboard-visibility">
          <div><h3>Restrict dashboard to own consultant data for non-admin users</h3><p>When enabled, only Admins/Super Admins can view Overall dashboard and other consultants’ dashboards.</p></div>
          <button className={`admin-ios-switch${dashboardRestricted ? ' is-on' : ''}`} type="button" role="switch" aria-checked={dashboardRestricted} aria-label="Restrict dashboard to own consultant data for non-admin users" disabled={savingPermissions} onClick={() => setDashboardRestricted(current => !current)}><span /></button>
        </div>
      </Section>

      <AttendancePermissionSettings
        values={draftAttendancePermissions}
        isSuperAdmin={isSuperAdmin}
        disabled={savingPermissions}
        onChange={(key, value) => setDraftAttendancePermissions(current => ({ ...current, [key]: value }))}
      />

      <PageViewPermissions
        isSuperAdmin={isSuperAdmin}
        permissions={draftPageViewPermissions}
        disabled={savingPermissions}
        onChange={(pageKey, viewPermission) => setDraftPageViewPermissions(current => ({ ...current, [pageKey]: viewPermission }))}
      />

      <Section
        title="Column Permissions"
        description="Control how columns appear and behave for non-admin users."
        icon={Shield}
      >
        <div className="admin-permission-toolbar">
          <div className="admin-tabs">
            {availableTabs.map(([key, label, Icon]) => (
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
          <span className="is-disabled"><i />{activeTab === PERFORMANCE_TABLE_KEY ? 'Disabled for non-super-admins' : 'Disabled for non-admins'}</span>
          <span className="is-hidden"><i />{activeTab === PERFORMANCE_TABLE_KEY ? 'Hidden from non-super-admins' : 'Hidden from non-admins'}</span>
        </div>

        <div className="admin-permission-table">
          <div className="admin-permission-head">
            <span>Column</span>
            <span>Current State</span>
            <span>Access Level</span>
          </div>
          {filteredColumns.map(column => {
            const value = draftPermissions?.[activeTab]?.[column.key] || 'everyone'
            const isPerformanceCalculated = activeTab === PERFORMANCE_TABLE_KEY && column.calculated
            return (
              <div className="admin-permission-row" key={column.key}>
                <div>
                  <div className="admin-permission-label">{column.label}</div>
                  <div className="admin-permission-key">{activeTab === PERFORMANCE_TABLE_KEY && !column.calculated ? <PerformancePermissionBadge value={value} /> : column.calculated ? 'Calculated fields remain read-only.' : PERMISSION_TEXT[value]}</div>
                </div>
                <StateChip value={value} />
                {isPerformanceCalculated ? (
                  <PerformanceCalculatedPermissionPicker value={value} onChange={(mode) => setDraftPermission(activeTab, column.key, mode)} />
                ) : (
                  <AdminPermissionPicker value={value} options={activeTab === PERFORMANCE_TABLE_KEY ? PERFORMANCE_PICKER_OPTIONS : undefined} onChange={(mode) => setDraftPermission(activeTab, column.key, mode)} />
                )}
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

      <EmployeeManagement ref={employeeManagementRef} onDirtyChange={setEmployeeManagementDirty} />

      {createPortal((
        <div className={`admin-unsaved-dock${dirty && !lockModalType ? ' is-visible' : ''}${savingPermissions ? ' is-saving' : ''}`} aria-hidden={!dirty || Boolean(lockModalType)}>
          <div className="admin-unsaved-dock-inner">
            <span><AlertTriangle size={18} /></span>
            <div>
              <strong>{employeeManagementDirty ? (permissionChangesDirty ? 'Unsaved changes' : 'Unsaved employee changes') : 'Unsaved permission changes'}</strong>
              <p>{employeeManagementDirty ? 'Review your employee updates and save them across the workspace.' : 'Review your edits and apply them across the workspace.'}</p>
            </div>
            <button className="admin-footer-cancel" type="button" onClick={cancelPermissionChanges} disabled={savingPermissions || !dirty}><X size={16} />Cancel</button>
            <button className="admin-footer-save" type="button" onClick={savePermissionChanges} disabled={savingPermissions || !dirty}><Save size={16} />{savingPermissions ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      ), document.body)}

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
