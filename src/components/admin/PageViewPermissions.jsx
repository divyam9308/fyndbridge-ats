import { useState } from 'react'
import { Eye, LoaderCircle } from 'lucide-react'
import { updatePageViewPermission } from '../../services/adminAccessApi'
import { setPageViewPermissions, usePageViewPermissions } from '../../hooks/usePageViewPermissions'
import { PAGE_VIEW_ITEMS } from '../../utils/pageViewPermissions'
import './PageViewPermissions.css'

const OPTIONS = [
  ['everyone', 'Everyone'],
  ['admin_only', 'Admin Only'],
  ['super_admin_only', 'Super Admin Only']
]

export default function PageViewPermissions({ isSuperAdmin }) {
  const { permissions, loading } = usePageViewPermissions()
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  const change = async (pageKey, viewPermission) => {
    if (!isSuperAdmin || saving || permissions[pageKey] === viewPermission) return
    setSaving(pageKey)
    setError('')
    try {
      const result = await updatePageViewPermission(pageKey, viewPermission)
      setPageViewPermissions(result.permissions)
    } catch (err) {
      setError(err.message || 'Unable to save page view permission.')
    } finally {
      setSaving('')
    }
  }

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
        {error && <div className="admin-error">{error}</div>}
        <div className="page-view-permission-list" aria-busy={loading}>
          {PAGE_VIEW_ITEMS.map(([pageKey, label]) => (
            <div className="page-view-permission-row" key={pageKey}>
              <div><h3>{label}</h3><p>{loading ? 'Loading permission…' : `Current: ${OPTIONS.find(([value]) => value === permissions[pageKey])?.[1] || 'Everyone'}`}</p></div>
              <div className="page-view-picker" aria-label={`${label} view permission`}>
                {OPTIONS.map(([value, optionLabel]) => (
                  <button key={value} type="button" disabled={!isSuperAdmin || loading || Boolean(saving)} className={permissions[pageKey] === value ? 'is-active' : ''} onClick={() => change(pageKey, value)}>
                    {saving === pageKey && permissions[pageKey] === value ? <LoaderCircle size={13} className="spin" /> : null}
                    {optionLabel}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!isSuperAdmin && <p className="page-view-permission-note">Only Super Admins can change page visibility.</p>}
      </div>
    </section>
  )
}
