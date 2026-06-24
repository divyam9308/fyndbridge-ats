const supabase = require('./supabaseAdmin')
const { isAdmin } = require('./adminAccess')

const KEY = 'dashboard_restrict_non_admin_to_self'

async function getDashboardAccess(user) {
  const [admin, setting, profile] = await Promise.all([
    isAdmin(user),
    supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle(),
    supabase.from('user_profiles').select('name').eq('user_id', user?.id).maybeSingle()
  ])
  const restricted = setting.error || setting.data?.value !== false
  const consultantName = String(profile.data?.name || '').trim()
  return { isAdmin: admin, restrictedToSelf: !admin && restricted, consultantName }
}

async function getDashboardVisibility() {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (error && error.code !== '42P01') throw error
  return { restrictNonAdminToSelf: !data || data.value !== false }
}

async function setDashboardVisibility(value) {
  const { error } = await supabase.from('app_settings').upsert({ key: KEY, value: Boolean(value), updated_at: new Date().toISOString() })
  if (error) throw error
  return getDashboardVisibility()
}

module.exports = { getDashboardAccess, getDashboardVisibility, setDashboardVisibility }
