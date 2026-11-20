const fs = require('node:fs/promises')
const path = require('node:path')

// Shared by permission/API/browser fixtures so CRM access is checked against
// the current RPC signatures, including unread filtering and activity receipts.
async function installCrmSchema(db) {
  for (const file of [
    '20261019105523_business_development_crm.sql',
    '20261020042221_crm_optional_contact_details.sql',
    '20261019110948_crm_probability_sorting.sql',
    '20261019165228_crm_gmail_integration.sql',
    '20261019182711_crm_gmail_manual_sync.sql',
    '20261023094350_crm_gmail_historical_sync.sql',
    '20261023112550_crm_gmail_shared_sync_and_client_history.sql',
    '20261023112559_crm_gmail_contact_search_and_event_time.sql',
    '20261023112611_crm_gmail_explicit_history_modes.sql',
    '20261019185136_crm_activity_read_receipts.sql',
    '20261021093133_crm_incoming_email_row_highlights.sql',
    '20261023131500_crm_unread_filter.sql',
    '20261023131700_crm_unread_filter_probability_order.sql',
    '20261023131600_crm_connected_through_candidate.sql',
    '20261021090008_crm_organisation_summary.sql',
    '20261120204725_stop_business_conflict_retries.sql'
  ]) await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8'))
}

module.exports = { installCrmSchema }
