// The Clients module's exact-name comparison, shared with CRM.
function normalizeClientName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').toLowerCase()
}
module.exports = { normalizeClientName }
