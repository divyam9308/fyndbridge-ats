const SHARED_CLIENT_FIELDS = [
  'client_display_id',
  'consultant_user_id',
  'consultant_name',
  'consultant',
  'client_name',
  'name',
  'location',
  'city',
  'region',
  'state',
  'sector',
  'status',
  'terms_signed_type',
  'terms_signed_custom',
  'terms_value',
  'billing_entity',
  'contract_signed',
  'gstin',
  'pan',
  'address_on_invoice',
  'contract_attachments',
  'contract_document',
  'contract_pdf_url',
  'contract_pdf_storage_path',
  'contract_document_name'
]

const CONTACT_CLIENT_FIELDS = [
  'contact_person',
  'contact',
  'mobile',
  'phone',
  'email',
  'designation',
  'linkedin',
  'connected_on_date',
  'comments',
  'notes'
]

function clientGroupOwnerId(client) {
  return client?.client_group_id || client?.id || ''
}

function pickFields(payload, fields) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(payload || {}, field)) result[field] = payload[field]
    return result
  }, {})
}

function mergeClientGroupRows(root, contact = root) {
  if (!root) return contact || null
  const selectedContact = contact || root
  const merged = { ...selectedContact }
  for (const field of SHARED_CLIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(root, field)) merged[field] = root[field]
  }
  merged.client_group_id = clientGroupOwnerId(root)
  merged.root_client_id = clientGroupOwnerId(root)
  return merged
}

function contactInsertPayload(root, payload) {
  return {
    ...pickFields(root, SHARED_CLIENT_FIELDS),
    client_group_id: clientGroupOwnerId(root),
    client_display_id: root.client_display_id || payload.client_display_id || null,
    client_name: root.client_name || root.name || payload.client_name || payload.name || '',
    name: root.name || root.client_name || payload.name || payload.client_name || '',
    ...pickFields(payload, CONTACT_CLIENT_FIELDS)
  }
}

async function resolveClientGroupScope(supabase, clientId) {
  const id = String(clientId || '').trim()
  if (!id) return { ownerId: '', ids: [], client: null, root: null }

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!client) return { ownerId: '', ids: [], client: null, root: null }

  const ownerId = clientGroupOwnerId(client)
  const [{ data: root, error: rootError }, { data: members, error: membersError }] = await Promise.all([
    ownerId === client.id
      ? Promise.resolve({ data: client, error: null })
      : supabase.from('clients').select('*').eq('id', ownerId).maybeSingle(),
    supabase.from('clients').select('id').eq('client_group_id', ownerId)
  ])
  if (rootError) throw rootError
  if (membersError) throw membersError

  return {
    ownerId,
    ids: [...new Set([ownerId, client.id, ...(members || []).map((row) => row.id)].filter(Boolean))],
    client,
    root: root || client
  }
}

module.exports = {
  CONTACT_CLIENT_FIELDS,
  SHARED_CLIENT_FIELDS,
  clientGroupOwnerId,
  contactInsertPayload,
  mergeClientGroupRows,
  pickFields,
  resolveClientGroupScope
}
