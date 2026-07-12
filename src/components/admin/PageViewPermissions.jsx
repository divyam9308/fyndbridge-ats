import { Eye, EyeOff, Lock } from 'lucide-react'
import { PAGE_VIEW_ITEMS } from '../../utils/pageViewPermissions'
import AdminPermissionPicker from './AdminPermissionPicker'
import './PageViewPermissions.css'

const OPTIONS = [
  { value: 'everyone', label: 'Everyone', Icon: Eye },
  { value: 'admin_only', label: 'Admin Only', Icon: Lock },
  { value: 'super_admin_only', label: 'Super Admin Only', Icon: EyeOff }
]

const toneForPermission = (value = 'everyone') => value === 'everyone' ? 'is-everyone' : value === 'admin_only' ? 'is-disabled' : 'is-hidden'
const stateClass = (value = 'everyone') => value === 'everyone' ? 'is-everyone' : value === 'admin_only' ? 'is-admin_disabled' : 'is-admin_hidden'

export default function PageViewPermissions({ isSuperAdmin, permissions, disabled, onChange }) {

  return (
    <section className="admin-section page-view-permissions">
      <div className="admin-section-header">
        <div className="admin-section-title-wrap">
          <div className="admin-section-icon"><Eye size={21} /></div>
          <div>
            <h2>Page View Permissions</h2>
            <p>Control which existing workspace role can view each page.</p>
          </div>
        </div>
      </div>
      <div className="admin-section-body">
        <div className="admin-permission-table page-view-permission-table">
          <div className="admin-permission-head">
            <span>Page</span><span>Current State</span><span>View Access</span>
          </div>
          {PAGE_VIEW_ITEMS.map(([pageKey, label]) => (
            <div className="admin-permission-row page-view-permission-row" key={pageKey}>
              <div><div className="admin-permission-label">{label}</div><div className="admin-permission-key">Controls who can see this page.</div></div>
              <span className={`admin-state-chip ${stateClass(permissions[pageKey])}`}>{OPTIONS.find(option => option.value === permissions[pageKey])?.label || 'Everyone'}</span>
              <AdminPermissionPicker value={permissions[pageKey] || 'everyone'} options={OPTIONS} toneForValue={toneForPermission} disabled={!isSuperAdmin || disabled} onChange={(value) => onChange(pageKey, value)} />
            </div>
          ))}
        </div>
        {!isSuperAdmin && <p className="page-view-permission-note">Only Super Admins can change page visibility.</p>}
      </div>
    </section>
  )
}
