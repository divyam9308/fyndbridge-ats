import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, Briefcase, Building2, CheckCircle2, ChevronRight, CircleOff, Clock3, Info, Mail, Phone, Search, Users, X } from 'lucide-react'
import { EMPLOYEE_MANAGEMENT_MOCK_DATA } from './employeeManagementMockData'
import './EmployeeManagement.css'

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

function cloneEmployees() {
  return EMPLOYEE_MANAGEMENT_MOCK_DATA.map(employee => ({
    ...employee,
    clients: [...employee.clients],
    mandates: [...employee.mandates],
    candidates: [...employee.candidates]
  }))
}

function LinkedRecordCard({ meta, records }) {
  const visible = records.slice(0, 4)
  const remaining = Math.max(0, records.length - visible.length)
  const Icon = meta.Icon
  return (
    <article className="employee-mgmt-linked-card">
      <div className="employee-mgmt-linked-head">
        <span className="employee-mgmt-linked-icon"><Icon size={18} /></span>
        <div>
          <h4>{meta.title}</h4>
          <p>{meta.description}</p>
        </div>
        <strong>{records.length}</strong>
      </div>
      {records.length ? (
        <div className="employee-mgmt-record-pills">
          {visible.map(record => <span key={record.id}>{record.name}</span>)}
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
  const destinations = useMemo(() => {
    const query = destinationSearch.trim().toLowerCase()
    return employees.filter(employee => employee.id !== source.id).filter(employee => !query || employee.name.toLowerCase().includes(query) || employee.email.toLowerCase().includes(query))
  }, [destinationSearch, employees, source.id])
  const selectedKeys = LINKED_RECORD_META.map(item => item.key).filter(key => selectedCategories[key] && source[key].length)
  const canConfirm = Boolean(destinationId && selectedKeys.length)
  const setAll = value => setSelectedCategories(Object.fromEntries(LINKED_RECORD_META.map(item => [item.key, value && source[item.key].length > 0])))

  return createPortal(
    <div className="modal-overlay employee-reassign-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal-card employee-reassign-modal" role="dialog" aria-modal="true" aria-labelledby="employee-reassign-title">
        <div className="modal-header">
          <div>
            <span className="modal-title" id="employee-reassign-title">Reassign Employee</span>
            <p>Transfer assignments from <strong>{source.name}</strong>.</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body employee-reassign-body">
          <div className="employee-reassign-field">
            <label htmlFor="employee-destination-search">Destination employee</label>
            <div className="employee-reassign-search">
              <Search size={17} />
              <input
                id="employee-destination-search"
                value={destinationSearch}
                onChange={event => { setDestinationSearch(event.target.value); setDestinationId('') }}
                placeholder="Search by name or email"
                autoComplete="off"
              />
              {destinationSearch && <button type="button" onClick={() => { setDestinationSearch(''); setDestinationId('') }} aria-label="Clear destination"><X size={15} /></button>}
            </div>
            <div className="employee-reassign-options" role="listbox" aria-label="Destination employees">
              {destinations.map(employee => {
                const unavailable = employee.status !== 'active'
                return (
                  <button
                    key={employee.id}
                    type="button"
                    role="option"
                    aria-selected={destinationId === employee.id}
                    className={destinationId === employee.id ? 'is-selected' : ''}
                    disabled={unavailable}
                    onClick={() => { setDestinationId(employee.id); setDestinationSearch(employee.name) }}
                  >
                    <span>{initials(employee.name)}</span>
                    <div><strong>{employee.name}</strong><small>{employee.email}</small></div>
                    <em className={`is-${employee.status}`}>{STATUS_OPTIONS.find(option => option.value === employee.status)?.label}</em>
                  </button>
                )
              })}
              {!destinations.length && <p>No employees match this search.</p>}
            </div>
          </div>

          <div className="employee-reassign-categories">
            <div className="employee-reassign-category-head">
              <div><strong>Assignments to transfer</strong><small>Select at least one category.</small></div>
              <span><button type="button" onClick={() => setAll(true)}>Select All</button><button type="button" onClick={() => setAll(false)}>Clear All</button></span>
            </div>
            {LINKED_RECORD_META.map(({ key, title, Icon }) => (
              <label key={key} className={source[key].length ? '' : 'is-disabled'}>
                <input type="checkbox" checked={selectedCategories[key]} disabled={!source[key].length} onChange={event => setSelectedCategories(current => ({ ...current, [key]: event.target.checked }))} />
                <span><Icon size={17} /></span>
                <strong>{title}</strong>
                <em>{source[key].length}</em>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer employee-reassign-footer">
          <button className="employee-reassign-cancel" type="button" onClick={onClose}>Cancel</button>
          <button className="employee-reassign-confirm" type="button" disabled={!canConfirm} onClick={() => onConfirm(destinationId, selectedKeys)}><ArrowRightLeft size={16} />Confirm Reassignment</button>
        </div>
      </section>
    </div>,
    document.body
  )
}

function employeesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const EmployeeManagement = forwardRef(function EmployeeManagement({ onDirtyChange }, ref) {
  const [employees, setEmployees] = useState(cloneEmployees)
  const savedEmployeesRef = useRef(employees)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => EMPLOYEE_MANAGEMENT_MOCK_DATA[0]?.id || '')
  const [reassignSourceId, setReassignSourceId] = useState('')
  const [toast, setToast] = useState('')

  const visibleEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return employees.filter(employee => statusFilter === 'all' || employee.status === statusFilter).filter(employee => !normalized || employee.name.toLowerCase().includes(normalized) || employee.email.toLowerCase().includes(normalized))
  }, [employees, query, statusFilter])

  const selectedEmployee = visibleEmployees.find(employee => employee.id === selectedEmployeeId) || visibleEmployees[0] || null
  const reassignSource = employees.find(employee => employee.id === reassignSourceId) || null

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useImperativeHandle(ref, () => ({
    saveChanges() {
      savedEmployeesRef.current = employees.map(employee => ({ ...employee, clients: [...employee.clients], mandates: [...employee.mandates], candidates: [...employee.candidates] }))
      onDirtyChange(false)
    },
    cancelChanges() {
      const saved = savedEmployeesRef.current.map(employee => ({ ...employee, clients: [...employee.clients], mandates: [...employee.mandates], candidates: [...employee.candidates] }))
      setEmployees(saved)
      setReassignSourceId('')
      onDirtyChange(false)
    }
  }), [employees, onDirtyChange])

  const updateEmployees = nextEmployees => {
    setEmployees(nextEmployees)
    onDirtyChange(!employeesMatch(nextEmployees, savedEmployeesRef.current))
  }

  const changeStatus = status => {
    if (!selectedEmployee) return
    updateEmployees(employees.map(employee => employee.id === selectedEmployee.id ? { ...employee, status } : employee))
  }

  const confirmReassignment = (destinationId, categories) => {
    const source = employees.find(employee => employee.id === reassignSourceId)
    const destination = employees.find(employee => employee.id === destinationId)
    if (!source || !destination || !categories.length) return
    const nextEmployees = employees.map(employee => {
      if (employee.id === source.id) {
        return categories.reduce((next, key) => ({ ...next, [key]: [] }), employee)
      }
      if (employee.id === destination.id) {
        return categories.reduce((next, key) => {
          const combined = [...next[key], ...source[key]]
          return { ...next, [key]: combined.filter((record, index) => combined.findIndex(item => item.id === record.id) === index) }
        }, employee)
      }
      return employee
    })
    updateEmployees(nextEmployees)
    setReassignSourceId('')
    setToast(`Reassignment staged from ${source.name} to ${destination.name}. Save changes to apply it.`)
  }

  return (
    <section className="admin-section employee-management-section">
      <div className="admin-section-header employee-mgmt-header">
        <div className="admin-section-title-wrap">
          <div className="admin-section-icon employee-mgmt-header-icon"><Users size={22} /></div>
          <div><h2>Employee Management</h2><p>View, manage and reassign employees in your workspace.</p></div>
        </div>
        <div className="employee-mgmt-info"><Info size={18} /><span>Employees appear here automatically after their first login and profile setup.</span></div>
      </div>

      <div className="employee-mgmt-shell">
        <aside className="employee-mgmt-list-panel">
          <div className="employee-mgmt-search">
            <Search size={17} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search employees by name or email" aria-label="Search employees by name or email" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear employee search"><X size={15} /></button>}
          </div>
          <div className="employee-mgmt-filters" aria-label="Filter employees by status">
            {[['all', 'All'], ...STATUS_OPTIONS.map(option => [option.value, option.label])].map(([value, label]) => (
              <button key={value} type="button" className={`is-filter-${value}${statusFilter === value ? ' is-active' : ''}`} onClick={() => setStatusFilter(value)}>{label}</button>
            ))}
          </div>
          <div className="employee-mgmt-list">
            {visibleEmployees.map(employee => (
              <button key={employee.id} type="button" className={selectedEmployee?.id === employee.id ? 'is-selected' : ''} onClick={() => setSelectedEmployeeId(employee.id)}>
                <span className="employee-mgmt-avatar is-small">{initials(employee.name)}</span>
                <span className="employee-mgmt-list-copy"><strong>{employee.name}</strong><small>{employee.email}</small></span>
                <i className={`is-${employee.status}`} aria-label={STATUS_OPTIONS.find(option => option.value === employee.status)?.label} />
                <ChevronRight size={17} />
              </button>
            ))}
            {!visibleEmployees.length && <div className="employee-mgmt-empty"><Users size={25} /><strong>No employees found</strong><span>Try a different name, email or status.</span></div>}
          </div>
          <div className="employee-mgmt-list-count">{visibleEmployees.length} {visibleEmployees.length === 1 ? 'employee' : 'employees'} visible</div>
        </aside>

        <div className="employee-mgmt-detail-panel">
          {selectedEmployee ? (
            <>
              <div className="employee-mgmt-profile">
                <span className="employee-mgmt-avatar">{initials(selectedEmployee.name)}</span>
                <div><h3>{selectedEmployee.name}</h3><p><Mail size={15} />{selectedEmployee.email}</p>{selectedEmployee.mobile && <p><Phone size={15} />{selectedEmployee.mobile}</p>}</div>
              </div>

              <div className="employee-mgmt-status-block">
                <div className="employee-mgmt-status-control">
                  {STATUS_OPTIONS.map(({ value, label, Icon }) => <button key={value} type="button" className={`is-status-${value}${selectedEmployee.status === value ? ' is-selected' : ''}`} onClick={() => changeStatus(value)}><Icon size={15} />{label}</button>)}
                </div>
                <p>{STATUS_HELP[selectedEmployee.status]}</p>
              </div>

              <div className="employee-mgmt-linked-list">
                {LINKED_RECORD_META.map(meta => <LinkedRecordCard key={meta.key} meta={meta} records={selectedEmployee[meta.key]} />)}
              </div>

              <div className="employee-mgmt-reassign-card">
                <span><ArrowRightLeft size={19} /></span>
                <div><h4>Reassign Employee</h4><p>Transfer this employee&apos;s assignments to another employee.</p></div>
                <button type="button" onClick={() => setReassignSourceId(selectedEmployee.id)}>Reassign</button>
              </div>
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
