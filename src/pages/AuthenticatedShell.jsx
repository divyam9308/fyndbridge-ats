import { OnlineUsersProvider } from '../hooks/useOnlineUsers'
import DashboardLayout from './DashboardLayout'

export default function AuthenticatedShell() {
  return <OnlineUsersProvider><DashboardLayout /></OnlineUsersProvider>
}
