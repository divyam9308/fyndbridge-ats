const supabase = require('./supabaseAdmin')

const OVERALL_CONSULTANT_KEY = 'overall'
const OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY = 'overall_consultant_report_audience'
const OVERALL_CONSULTANT_REPORT_AUDIENCES = new Set(['admins', 'super_admins'])

function normalizeOverallConsultantReportAudience(value, fallback = 'super_admins') {
  const audience = String(value || '').trim().toLowerCase()
  return OVERALL_CONSULTANT_REPORT_AUDIENCES.has(audience) ? audience : fallback
}

function canViewOverallConsultantReport({ admin = false, superAdmin = false } = {}, audience = 'admins') {
  if (superAdmin) return true
  return Boolean(admin && normalizeOverallConsultantReportAudience(audience) === 'admins')
}

async function getOverallConsultantReportAudience() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY)
    .maybeSingle()
  if (error) throw error
  return data ? normalizeOverallConsultantReportAudience(data.value) : 'admins'
}

async function setOverallConsultantReportAudience(value) {
  const audience = String(value || '').trim().toLowerCase()
  if (!OVERALL_CONSULTANT_REPORT_AUDIENCES.has(audience)) {
    const error = new Error('Invalid Overall Consultants report audience.')
    error.statusCode = 400
    throw error
  }
  const { error } = await supabase.from('app_settings').upsert({
    key: OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY,
    value: audience,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' })
  if (error) throw error
  return audience
}

module.exports = {
  OVERALL_CONSULTANT_KEY,
  OVERALL_CONSULTANT_REPORT_AUDIENCE_KEY,
  OVERALL_CONSULTANT_REPORT_AUDIENCES,
  canViewOverallConsultantReport,
  getOverallConsultantReportAudience,
  normalizeOverallConsultantReportAudience,
  setOverallConsultantReportAudience
}
