import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { PAGE_VIEW_ITEMS, CONSULTANT_ACCESS_ITEMS, INDIVIDUAL_ACCESS_KEYS } from '../../utils/pageViewPermissions'
import { useStaffDirectory } from '../../hooks/useStaffDirectory'
import AdminPermissionPicker from './AdminPermissionPicker'
import './PageViewPermissions.css'

const OPTIONS = [
  { value: 'everyone', label: 'Everyone', Icon: Eye },
  { value: 'admin_only', label: 'Admin Only', Icon: Lock },
  { value: 'super_admin_only', label: 'Super Admin Only', Icon: EyeOff }
]
const toneForPermission = (value = 'everyone') => value === 'everyone' ? 'is-everyone' : value === 'admin_only' ? 'is-disabled' : 'is-hidden'
const stateClass = (value = 'everyone') => value === 'everyone' ? 'is-everyone' : value === 'admin_only' ? 'is-admin_disabled' : 'is-admin_hidden'

export default function PageViewPermissions({ isSuperAdmin, permissions, disabled, onChange, consultantAccess = {}, onConsultantChange }) {
  const { staff, selectableStaff, loading } = useStaffDirectory()
  const [searches, setSearches] = useState({})
  const row = ([key, label]) => {
    const ids = consultantAccess[key] || [], selected = new Set(ids)
    const available = [...selectableStaff, ...ids.filter(id=>!selectableStaff.some(person=>person.user_id===id)).map(id=>staff.find(person=>person.user_id===id) || {user_id:id,name:'Unavailable consultant',status:'inactive'})]
    const query = (searches[key] || '').toLowerCase()
    return <div className="admin-permission-row page-view-permission-row" key={key}>
      <div><div className="admin-permission-label">{label}</div><div className="admin-permission-key">{key.includes('assigned_candidates_') ? 'Controls access to this Assigned Candidates control.' : 'Controls who can see this page.'}</div></div>
      <span className={`admin-state-chip ${stateClass(permissions[key])}`}>{OPTIONS.find(option=>option.value===permissions[key])?.label || 'Everyone'}{ids.length>0 && ` + ${ids.length} selected`}</span>
      <div>
        <AdminPermissionPicker value={permissions[key] || 'everyone'} options={OPTIONS} toneForValue={toneForPermission} disabled={!isSuperAdmin || disabled} onChange={value=>onChange(key,value)} />
        {INDIVIDUAL_ACCESS_KEYS.includes(key) && <details className="admin-consultant-access">
          <summary>Selected consultants ({ids.length}) · {label}</summary>
          <p className="sub-text">Selected consultants receive access in addition to the role above. Choose Admin Only or Super Admin Only to restrict other consultants.</p>
          <input type="search" className="form-control" aria-label={`Search consultants for ${label}`} placeholder="Search consultants..." value={searches[key] || ''} onChange={event=>setSearches(current=>({...current,[key]:event.target.value}))} />
          <fieldset disabled={!isSuperAdmin || disabled || loading} aria-label={`Consultants with access to ${label}`}>
            {available.filter(person=>!query || `${person.name} ${person.email || ''}`.toLowerCase().includes(query)).map(person=><label key={person.user_id} className="admin-consultant-option">
              <input type="checkbox" checked={selected.has(person.user_id)} disabled={!selected.has(person.user_id) && !selectableStaff.some(active=>active.user_id===person.user_id)} onChange={event=>onConsultantChange?.(key,event.target.checked?[...ids,person.user_id]:ids.filter(id=>id!==person.user_id))} />
              <span>{person.name}{!selectableStaff.some(active=>active.user_id===person.user_id) && ' (inactive / unavailable)'}</span>
            </label>)}
            {loading && <span role="status">Loading consultants...</span>}
            {!loading && !available.length && <span className="sub-text">No active consultants available.</span>}
          </fieldset>
        </details>}
      </div>
    </div>
  }
  return <section className="admin-section page-view-permissions">
    <div className="admin-section-header"><div className="admin-section-title-wrap"><div className="admin-section-icon"><Eye size={21} /></div><div><h2>Page View Permissions</h2><p>Control page visibility and give selected consultants access to CRM and Assigned Candidates controls.</p></div></div></div>
    <div className="admin-section-body"><div className="admin-permission-table page-view-permission-table">
      <div className="admin-permission-head"><span>Page / Control</span><span>Current State</span><span>View Access</span></div>
      {PAGE_VIEW_ITEMS.map(row)}
      {CONSULTANT_ACCESS_ITEMS.map(row)}
    </div>{!isSuperAdmin && <p className="page-view-permission-note">Only Super Admins can change these permissions.</p>}</div>
  </section>
}
