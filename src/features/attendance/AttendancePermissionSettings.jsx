import { EyeOff, Lock, ShieldCheck } from 'lucide-react'
import AdminPermissionPicker from '../../components/admin/AdminPermissionPicker'
import { PERMISSION_ITEMS } from './attendanceData'

const OPTIONS = [
  { value: 'admins', label: 'Admins', Icon: Lock },
  { value: 'super_admins', label: 'Super Admins', Icon: EyeOff }
]

const toneForPermission = (value) => value === 'admins' ? 'is-disabled' : 'is-hidden'
const stateClass = (value) => value === 'admins' ? 'is-admin_disabled' : 'is-admin_hidden'

export default function AttendancePermissionSettings({ values, isSuperAdmin, disabled, onChange }) {
  return (
    <section className="admin-section att-admin-permissions">
      <div className="admin-section-header">
        <div className="admin-section-title-wrap">
          <div className="admin-section-icon"><ShieldCheck size={21} /></div>
          <div>
            <h2>Attendance Permissions</h2>
            <p>Choose which administrator role can use each Attendance &amp; Leave capability.</p>
          </div>
        </div>
      </div>
      <div className="admin-section-body">
        <div className="admin-permission-table attendance-permission-table">
          <div className="admin-permission-head">
            <span>Attendance Capability</span><span>Current State</span><span>Access Level</span>
          </div>
          {PERMISSION_ITEMS.map(([key, title, description]) => {
            const value = values[key] || 'admins'
            return (
              <div className="admin-permission-row" key={key}>
                <div><div className="admin-permission-label">{title}</div><div className="admin-permission-key">{description}</div></div>
                <span className={`admin-state-chip ${stateClass(value)}`}>{value === 'admins' ? 'Admins' : 'Super Admins'}</span>
                <AdminPermissionPicker value={value} options={OPTIONS} toneForValue={toneForPermission} disabled={!isSuperAdmin || disabled} onChange={(nextValue) => onChange(key, nextValue)} />
              </div>
            )
          })}
        </div>
        {!isSuperAdmin && <p className="page-view-permission-note">Only Super Admins can change attendance permissions.</p>}
      </div>
    </section>
  )
}
