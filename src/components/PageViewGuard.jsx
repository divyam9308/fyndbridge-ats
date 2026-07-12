import { Navigate } from 'react-router-dom'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { usePageViewPermissions } from '../hooks/usePageViewPermissions'

export default function PageViewGuard({ pageKey, children }) {
  const { isAdmin, isSuperAdmin, loading: roleLoading } = useAdminAccess({ loadPermissions: false })
  const pages = usePageViewPermissions({ isAdmin, isSuperAdmin })
  if (roleLoading || pages.loading) return <div className="route-loading" role="status">Loading...</div>
  if (pages.canView(pageKey)) return children
  return <Navigate to={pages.firstPermittedRoute(pageKey)} replace />
}
