import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, Briefcase, Building2, CheckCircle2, ChevronRight, CircleOff, Clock3, Info, Mail, Phone, Search, Users, X } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import { fetchEmployeeDetail, fetchEmployees, reassignEmployee, saveEmployeeStatus } from '../../services/employeeManagementApi'
import './EmployeeManagement.css'

const NOOP = () => {}
const STATUS_EVENT = 'fb:employee-status-changed'
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', Icon: CheckCircle2 },
  { value: 'on_leave', label: 'On Leave', Icon: Clock3 },
  { value: 'inactive', label: 'Inactive', Icon: CircleOff }
]
const STATUS_HELP = {
  active: 'Employee can log in and receive new assignments.',
  on_leave: 'Employee remains in the system but should not receive new assignments.',
  inactive: 'Employee has left the company and should not receive new assignments.'
}
const LINKED_RECORD_META = [
  { key: 'clients', title: 'Clients', description: 'Clients linked to this employee', empty: 'No clients linked', Icon: Building2 },
  { key: 'mandates', title: 'Mandates', description: 'Mandates linked to this employee', empty: 'No mandates linked', Icon: Briefcase },
  { key: 'candidates', title: 'Candidates', description: 'Candidates linked to this employee', empty: 'No candidates linked', Icon: Users }
]

function initials(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'EM'
}

function normalizeEmployees(rows) {
  return (Array.isArray(rows) ? rows : []).map((employee) => ({
    ...employee,
    id: employee.id || employee.user_id,
    counts: {
      clients: Number(employee.counts?.clients || 0),
      mandates: Number(employee.counts?.mandates || 0),
      candidates: Number(employee.counts?.candidates || 0)
    }
  }))
}

function EmployeeListSkeleton() {
  return <div className="employee-mgmt-list-skeleton" aria-label="Loading employees">{Array.from({ length: 6 }, (_, index) => <span key={index}><i /><b /><em /></span>)}</div>
}

function EmployeeDetailSkeleton() {
  return <div className="employee-mgmt-detail-skeleton" aria-label="Loading employee details"><span /><i />{LINKED_RECORD_META.map(({ key }) => <b key={key} />)}</div>
}

function LinkedRecordCard({ meta, records, total, loading, error, onRetry }) {
  const Icon = meta.Icon
  const remaining = Math.max(0, total - records.length)
  return (
    <article className="employee-mgmt-linked-card">
      <div className="employee-mgmt-linked-head">
        <span className="employee-mgmt-linked-icon"><Icon size={18} /></span>
        <div><h4>{meta.title}</h4><p>{meta.description}</p></div>
        <strong>{total}</strong>
      </div>
      {loading ? <div className="employee-mgmt-preview-skeleton"><i /><i /><i /></div> : error ? (
        <div className="employee-mgmt-linked-empty is-error">Unable to load preview. <button type="button" onClick={onRetry}>Retry</button></div>
      ) : records.length ? (
        <div className="employee-mgmt-record-pills">
          {records.map(record => <span key={record.id}>{record.name}</span>)}
          {remaining > 0 && <span className="is-more">+{remaining} more</span>}
        </div>
      ) : <div className="employee-mgmt-linked-empty">{meta.empty}</div>}
    </article>
  )
}

function ReassignmentModal({ source, employees, onClose, onConfirm }) {
  const [destinationSearch, setDestinationSearch] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [selectedCategories, setSelectedCategories] = useState({ clients: false, mandates: false, candidates: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const destinations = useMemo(() => {
    const query = destinationSearch.trim().toLowerCase()
    return employees
      .filter(employee => employee.id !== source.id && employee.status === 'active')
      .filter(employee => !query || employee.name.toLowerCase().includes(query) || employee.email.toLowerCase().includes(query))
  }, [destinationSearch, employees, source.id])
  const selectedKeys = LINKED_RECORD_META.map(item => item.key).filter(key => selectedCategories[key] && source.counts[key] > 0)
  const canConfirm = Boolean(destinationId && selectedKeys.length && !saving)
  const setAll = value => setSelectedCategories(Object.fromEntries(LINKED_RECORD_META.map(item => [item.key, value && source.counts[item.key] > 0])))
  const confirm = async () => {
    if (!canConfirm) return
    setSaving(true)
    setError('')
    try {
      await onConfirm(destinationId, selectedKeys)
    } catch (submitError) {
      setError(submitError.message || 'Unable to reassign employee.')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay employee-reassign-overlay" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
      <section className="modal-card employee-reassign-modal" role="dialog" aria-modal="true" aria-labelledby="employee-reassign-title">
        <div className="modal-header">
          <div><span className="modal-title" id="employee-reassign-title">Reassign Employee</span><p>Transfer assignments from <strong>{source.name}</strong>.</p></div>
          <button className="modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body employee-reassign-body">
          <div className="employee-reassign-field">
            <label htmlFor="employee-destination-search">Destination employee</label>
            <div className="employee-reassign-search">
              <Search size={17} />
              <input id="employee-destination-search" value={destinationSearch} disabled={saving} onChange={event => { setDestinationSearch(event.target.value); setDestinationId('') }} placeholder="Search by name or email" autoComplete="off" />
              {destinationSearch && <button type="button" disabled={saving} onClick={() => { setDestinationSearch(''); setDestinationId('') }} aria-label="Clear destination"><X size={15} /></button>}
            </div>
            <div className="employee-reassign-options" role="listbox" aria-label="Destination employees">
              {destinations.map(employee => (
                <button key={employee.id} type="button" role="option" aria-selected={destinationId === employee.id} className={destinationId === employee.id ? 'is-selected' : ''} disabled={saving} onClick={() => { setDestinationId(employee.id); setDestinationSearch(employee.name) }}>
                  <span>{initials(employee.name)}</span>
                  <div><strong>{employee.name}</strong><small>{employee.email}</small></div>
                  <em className="is-active">Active</em>
                </button>
              ))}
              {!destinations.length && <p>No Active employees match this search.</p>}
            </div>
          </div>
          <div className="employee-reassign-categories">
            <div className="employee-reassign-category-head">
              <div><strong>Assignments to transfer</strong><small>Select at least one category.</small></div>
              <span><button type="button" disabled={saving} onClick={() => setAll(true)}>Select All</button><button type="button" disabled={saving} onClick={() => setAll(false)}>Clear All</button></span>
            </div>
            {LINKED_RECORD_META.map(({ key, title, Icon }) => (
              <label key={key} className={source.counts[key] ? '' : 'is-disabled'}>
                <input type="checkbox" checked={selectedCategories[key]} disabled={saving || !source.counts[key]} onChange={event => setSelectedCategories(current => ({ ...current, [key]: event.target.checked }))} />
                <span><Icon size={17} /></span><strong>{title}</strong><em>{source.counts[key]}</em>
              </label>
            ))}
          </div>
          {error && <div className="employee-reassign-error" role="alert">{error}</div>}
        </div>
        <div className="modal-footer employee-reassign-footer">
          <button className="employee-reassign-cancel" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="employee-reassign-confirm" type="button" disabled={!canConfirm} onClick={confirm}><ArrowRightLeft size={16} />{saving ? 'Reassigning...' : 'Confirm Reassignment'}</button>
        </div>
      </section>
    </div>,
    document.body
  )
}

const EmployeeManagement = forwardRef(function EmployeeManagement({ isSuperAdmin = false, onDirtyChange = NOOP }, ref) {
  const { employmentStatusByUserId, registerEmploymentStatuses } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [details, setDetails] = useState({})
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [reassignSourceId, setReassignSourceId] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [toast, setToast] = useState('')
  const savedStatusesRef = useRef({})

  const loadEmployees = useCallback(async (preserveDrafts = true) => {
    setLoading(true)
    setListError('')
    try {
      const rows = normalizeEmployees(await fetchEmployees())
      registerEmploymentStatuses(rows)
      setEmployees((current) => {
        const draftById = preserveDrafts ? new Map(current.filter((employee) => employee.status !== savedStatusesRef.current[employee.id]).map((employee) => [employee.id, employee.status])) : new Map()
        savedStatusesRef.current = Object.fromEntries(rows.map((employee) => [employee.id, employee.status]))
        return rows.map((employee) => draftById.has(employee.id) ? { ...employee, status: draftById.get(employee.id) } : employee)
      })
      setSelectedEmployeeId((current) => rows.some((employee) => employee.id === current) ? current : rows[0]?.id || '')
    } catch (error) {
      setListError(error.message || 'Unable to load employees.')
    } finally {
      setLoading(false)
    }
  }, [registerEmploymentStatuses])

  const loadDetail = useCallback(async (employeeId) => {
    if (!employeeId) return
    setDetails((current) => ({ ...current, [employeeId]: { ...current[employeeId], loading: true, error: '' } }))
    try {
      const data = await fetchEmployeeDetail(employeeId)
      setDetails((current) => ({ ...current, [employeeId]: { ...data, loaded: true, loading: false, error: '' } }))
    } catch (error) {
      setDetails((current) => ({ ...current, [employeeId]: { ...current[employeeId], loading: false, error: error.message || 'Unable to load assignments.' } }))
    }
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    setEmployees((current) => current.map((employee) => {
      const realtimeStatus = employmentStatusByUserId[employee.id]
      if (!realtimeStatus) return employee
      const savedStatus = savedStatusesRef.current[employee.id]
      savedStatusesRef.current[employee.id] = realtimeStatus
      return employee.status === savedStatus ? { ...employee, status: realtimeStatus } : employee
    }))
  }, [employmentStatusByUserId])

  useEffect(() => {
    if (!loading) onDirtyChange(employees.some((employee) => employee.status !== savedStatusesRef.current[employee.id]))
  }, [employees, loading, onDirtyChange])

  useEffect(() => {
    const handleStatusInsert = (event) => {
      const userId = event.detail?.user_id
      if (userId && !employees.some((employee) => employee.id === userId)) loadEmployees()
    }
    window.addEventListener(STATUS_EVENT, handleStatusInsert)
    return () => window.removeEventListener(STATUS_EVENT, handleStatusInsert)
  }, [employees, loadEmployees])

  const visibleEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return employees.filter(employee => statusFilter === 'all' || employee.status === statusFilter).filter(employee => !normalized || employee.name.toLowerCase().includes(normalized) || employee.email.toLowerCase().includes(normalized))
  }, [employees, query, statusFilter])
  const selectedEmployee = visibleEmployees.find(employee => employee.id === selectedEmployeeId) || visibleEmployees[0] || null
  const selectedDetail = selectedEmployee ? details[selectedEmployee.id] || {} : {}
  const reassignSource = employees.find(employee => employee.id === reassignSourceId) || null

  useEffect(() => {
    if (selectedEmployee?.id && !selectedDetail.loaded && !selectedDetail.loading) loadDetail(selectedEmployee.id)
  }, [loadDetail, selectedDetail.loaded, selectedDetail.loading, selectedEmployee?.id])

  const changeStatus = (status) => {
    if (!isSuperAdmin || !selectedEmployee || statusSaving) return
    const next = employees.map(employee => employee.id === selectedEmployee.id ? { ...employee, status } : employee)
    setEmployees(next)
    onDirtyChange(next.some(employee => employee.status !== savedStatusesRef.current[employee.id]))
  }

  const cancelChanges = useCallback(() => {
    setEmployees((current) => current.map((employee) => ({ ...employee, status: savedStatusesRef.current[employee.id] || employee.status })))
    setReassignSourceId('')
    onDirtyChange(false)
  }, [onDirtyChange])

  const saveChanges = useCallback(async () => {
    if (!isSuperAdmin) return
    const changes = employees.filter((employee) => employee.status !== savedStatusesRef.current[employee.id])
    if (!changes.length) return
    setStatusSaving(true)
    try {
      const results = await Promise.all(changes.map((employee) => saveEmployeeStatus(employee.id, employee.status)))
      const canonical = new Map(results.map((result) => [result.user_id, result.status]))
      results.forEach(registerEmploymentStatuses)
      setEmployees((current) => current.map((employee) => canonical.has(employee.id) ? { ...employee, status: canonical.get(employee.id) } : employee))
      for (const [employeeId, status] of canonical) savedStatusesRef.current[employeeId] = status
      onDirtyChange(false)
      setToast(`${results.length} employee status ${results.length === 1 ? 'change' : 'changes'} saved.`)
    } catch (error) {
      await loadEmployees(false)
      onDirtyChange(false)
      throw error
    } finally {
      setStatusSaving(false)
    }
  }, [employees, isSuperAdmin, loadEmployees, onDirtyChange, registerEmploymentStatuses])

  useImperativeHandle(ref, () => ({ saveChanges, cancelChanges }), [cancelChanges, saveChanges])

  const confirmReassignment = async (destinationId, categories) => {
    const source = employees.find(employee => employee.id === reassignSourceId)
    const destination = employees.find(employee => employee.id === destinationId)
    if (!source || !destination || !categories.length) throw new Error('Select a destination and at least one category.')
    const result = await reassignEmployee(source.id, destination.id, categories)
    const affected = { clients: Number(result.clients || 0), mandates: Number(result.mandates || 0), candidates: Number(result.candidates || 0) }
    setEmployees((current) => current.map((employee) => {
      if (employee.id === source.id) return { ...employee, counts: Object.fromEntries(Object.keys(employee.counts).map((key) => [key, Math.max(0, employee.counts[key] - affected[key])])) }
      if (employee.id === destination.id) return { ...employee, counts: Object.fromEntries(Object.keys(employee.counts).map((key) => [key, employee.counts[key] + affected[key]])) }
      return employee
    }))
    setDetails((current) => {
      const next = { ...current }
      delete next[source.id]
      delete next[destination.id]
      return next
    })
    if ([source.id, destination.id].includes(selectedEmployee?.id)) await loadDetail(selectedEmployee.id)
    setReassignSourceId('')
    const parts = LINKED_RECORD_META.map(({ key, title }) => affected[key] ? `${affected[key]} ${title.toLowerCase()}` : '').filter(Boolean)
    setToast(`Reassigned ${parts.join(', ') || '0 assignments'} to ${destination.name}.`)
  }

  return (
    <section className="admin-section employee-management-section">
      <div className="admin-section-header employee-mgmt-header">
        <div className="admin-section-title-wrap"><div className="admin-section-icon employee-mgmt-header-icon"><Users size={22} /></div><div><h2>Employee Management</h2><p>View, manage and reassign employees in your workspace.</p></div></div>
        <div className="employee-mgmt-info"><Info size={18} /><span>Employees appear here automatically after their first login and profile setup.</span></div>
      </div>
      <div className="employee-mgmt-shell">
        <aside className="employee-mgmt-list-panel">
          <div className="employee-mgmt-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search employees by name or email" aria-label="Search employees by name or email" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear employee search"><X size={15} /></button>}</div>
          <div className="employee-mgmt-filters" aria-label="Filter employees by status">
            {[['all', 'All'], ...STATUS_OPTIONS.map(option => [option.value, option.label])].map(([value, label]) => <button key={value} type="button" className={`is-filter-${value}${statusFilter === value ? ' is-active' : ''}`} onClick={() => setStatusFilter(value)}>{label}</button>)}
          </div>
          <div className="employee-mgmt-list">
            {loading ? <EmployeeListSkeleton /> : listError ? <div className="employee-mgmt-empty is-error"><CircleOff size={25} /><strong>Unable to load employees</strong><span>{listError}</span><button type="button" onClick={() => loadEmployees()}>Retry</button></div> : visibleEmployees.map(employee => (
              <button key={employee.id} type="button" className={selectedEmployee?.id === employee.id ? 'is-selected' : ''} onClick={() => setSelectedEmployeeId(employee.id)}>
                <span className="employee-mgmt-avatar is-small">{initials(employee.name)}</span><span className="employee-mgmt-list-copy"><strong>{employee.name}</strong><small>{employee.email}</small></span><i className={`is-${employee.status}`} aria-label={STATUS_OPTIONS.find(option => option.value === employee.status)?.label} /><ChevronRight size={17} />
              </button>
            ))}
            {!loading && !listError && !visibleEmployees.length && <div className="employee-mgmt-empty"><Users size={25} /><strong>{employees.length ? 'No matching employees' : 'No employees yet'}</strong><span>{employees.length ? 'Try a different name, email or status.' : 'Employees appear after profile setup.'}</span></div>}
          </div>
          <div className="employee-mgmt-list-count">{loading ? 'Loading employees…' : `${visibleEmployees.length} ${visibleEmployees.length === 1 ? 'employee' : 'employees'} visible`}</div>
        </aside>
        <div className="employee-mgmt-detail-panel">
          {loading ? <EmployeeDetailSkeleton /> : selectedEmployee ? (
            <>
              <div className="employee-mgmt-profile"><span className="employee-mgmt-avatar">{initials(selectedEmployee.name)}</span><div><h3>{selectedEmployee.name}</h3><p><Mail size={15} />{selectedEmployee.email}</p>{selectedEmployee.mobile && <p><Phone size={15} />{selectedEmployee.mobile}</p>}</div></div>
              <div className="employee-mgmt-status-block"><div className="employee-mgmt-status-control">{STATUS_OPTIONS.map(({ value, label, Icon }) => <button key={value} type="button" disabled={!isSuperAdmin || statusSaving} title={!isSuperAdmin ? 'Super Admin required.' : undefined} className={`is-status-${value}${selectedEmployee.status === value ? ' is-selected' : ''}`} onClick={() => changeStatus(value)}><Icon size={15} />{statusSaving ? 'Saving…' : label}</button>)}</div><p>{STATUS_HELP[selectedEmployee.status]}</p></div>
              <div className="employee-mgmt-linked-list">{LINKED_RECORD_META.map(meta => <LinkedRecordCard key={meta.key} meta={meta} records={selectedDetail[meta.key] || []} total={selectedEmployee.counts[meta.key]} loading={Boolean(selectedDetail.loading)} error={selectedDetail.error} onRetry={() => loadDetail(selectedEmployee.id)} />)}</div>
              <div className="employee-mgmt-reassign-card"><span><ArrowRightLeft size={19} /></span><div><h4>Reassign Employee</h4><p>Transfer this employee&apos;s assignments to another employee.</p></div><button type="button" disabled={!isSuperAdmin} title={!isSuperAdmin ? 'Super Admin required.' : undefined} onClick={() => setReassignSourceId(selectedEmployee.id)}>Reassign</button></div>
            </>
          ) : <div className="employee-mgmt-detail-empty"><Users size={30} /><strong>Select an employee</strong><span>Employee details will appear here.</span></div>}
        </div>
      </div>
      {reassignSource && <ReassignmentModal key={reassignSource.id} source={reassignSource} employees={employees} onClose={() => setReassignSourceId('')} onConfirm={confirmReassignment} />}
      {toast && createPortal(<div className="notice-toast is-visible" role="status"><CheckCircle2 size={17} /><span>{toast}</span><button className="notice-toast-close" type="button" onClick={() => setToast('')} aria-label="Close"><X size={14} /></button></div>, document.body)}
    </section>
  )
})

export default EmployeeManagement
