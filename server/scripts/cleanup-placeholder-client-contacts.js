const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = require('../src/services/supabaseAdmin')

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function isPlaceholderContact(row) {
  if (!row.client_group_id || row.id === row.client_group_id) return false
  const contactName = clean(row.contact_person || row.contact).toLowerCase()
  const hasPlaceholderName = !contactName || /^contact\s+\d+$/.test(contactName)
  const hasDetails = [row.mobile, row.phone, row.email, row.linkedin, row.designation]
    .some(value => Boolean(clean(value)))
  return Boolean(row.client_group_id && hasPlaceholderName && !hasDetails)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { data, error } = await supabase
    .from('clients')
    .select('id, client_group_id, client_display_id, client_name, name, contact_person, contact, mobile, phone, email, linkedin, designation')

  if (error) throw error

  const placeholders = (data || []).filter(isPlaceholderContact)

  if (!placeholders.length) {
    console.log('No placeholder contact rows found.')
    return
  }

  console.table(placeholders.map(row => ({
    id: row.id,
    client_group_id: row.client_group_id,
    client_display_id: row.client_display_id,
    client_name: row.client_name || row.name,
    contact_person: row.contact_person || row.contact || ''
  })))

  if (!apply) {
    console.log(`Preview only. Re-run with --apply to delete ${placeholders.length} placeholder rows.`)
    return
  }

  const { error: deleteError } = await supabase
    .from('clients')
    .delete()
    .in('id', placeholders.map(row => row.id))

  if (deleteError) throw deleteError
  console.log(`Deleted ${placeholders.length} placeholder contact rows.`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
