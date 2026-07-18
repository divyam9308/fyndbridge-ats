const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  CONTACT_CLIENT_FIELDS,
  SHARED_CLIENT_FIELDS,
  contactInsertPayload,
  mergeClientGroupRows
} = require('./clientGroups')

const root = path.resolve(__dirname, '../../..')
const clientController = fs.readFileSync(path.join(root, 'server/src/controllers/clientController.js'), 'utf8')
const jobController = fs.readFileSync(path.join(root, 'server/src/controllers/jobController.js'), 'utf8')
const candidateController = fs.readFileSync(path.join(root, 'server/src/controllers/candidateController.js'), 'utf8')
const clientsPage = fs.readFileSync(path.join(root, 'src/pages/ClientsPage.jsx'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260718070818_enforce_root_client_ownership.sql'),
  'utf8'
)

test('group merges keep shared root details and selected contact details separate', () => {
  const rootClient = {
    id: 'root-client',
    client_group_id: 'root-client',
    client_display_id: 'CL36',
    client_name: 'PES University',
    consultant_name: 'Root Consultant',
    status: 'Active',
    contract_signed: true,
    contract_attachments: [{ path: 'contracts/pes.pdf' }],
    contact_person: 'Root Contact',
    email: 'root@example.com',
    mobile: '111'
  }
  const selectedContact = {
    id: 'contact-client',
    client_group_id: 'root-client',
    client_name: 'Stale Client Name',
    consultant_name: 'Stale Consultant',
    status: 'Inactive',
    contract_signed: false,
    contract_attachments: [],
    contact_person: 'Second Contact',
    email: 'second@example.com',
    mobile: '222',
    designation: 'Vice Chancellor',
    linkedin: 'https://linkedin.example/second',
    connected_on_date: '2026-07-18',
    comments: 'Call this contact'
  }

  const merged = mergeClientGroupRows(rootClient, selectedContact)

  assert.equal(merged.id, 'contact-client')
  assert.equal(merged.root_client_id, 'root-client')
  assert.equal(merged.client_name, 'PES University')
  assert.equal(merged.consultant_name, 'Root Consultant')
  assert.equal(merged.status, 'Active')
  assert.equal(merged.contract_signed, true)
  assert.deepEqual(merged.contract_attachments, [{ path: 'contracts/pes.pdf' }])
  assert.equal(merged.contact_person, 'Second Contact')
  assert.equal(merged.email, 'second@example.com')
  assert.equal(merged.mobile, '222')
  assert.equal(merged.designation, 'Vice Chancellor')
  assert.equal(merged.comments, 'Call this contact')
})

test('new contact rows copy shared root details and accept only contact metadata overrides', () => {
  const payload = contactInsertPayload({
    id: 'root-client',
    client_group_id: 'root-client',
    client_display_id: 'CL36',
    client_name: 'PES University',
    name: 'PES University',
    consultant_name: 'Root Consultant',
    status: 'Active',
    contract_signed: true,
    contract_attachments: [{ path: 'contracts/pes.pdf' }]
  }, {
    client_name: 'Attempted Override',
    consultant_name: 'Attempted Override',
    status: 'Inactive',
    contract_signed: false,
    contract_attachments: [],
    contact_person: 'Second Contact',
    email: 'second@example.com',
    mobile: '222',
    designation: 'Vice Chancellor',
    linkedin: 'https://linkedin.example/second',
    connected_on_date: '2026-07-18',
    comments: 'Call this contact'
  })

  assert.equal(payload.client_group_id, 'root-client')
  assert.equal(payload.client_name, 'PES University')
  assert.equal(payload.consultant_name, 'Root Consultant')
  assert.equal(payload.status, 'Active')
  assert.equal(payload.contract_signed, true)
  assert.deepEqual(payload.contract_attachments, [{ path: 'contracts/pes.pdf' }])
  assert.equal(payload.contact_person, 'Second Contact')
  assert.equal(payload.email, 'second@example.com')
  assert.equal(payload.mobile, '222')
  assert.equal(payload.designation, 'Vice Chancellor')
  assert.equal(payload.connected_on_date, '2026-07-18')
  assert.equal(payload.comments, 'Call this contact')
})

test('the shared and contact field allowlists do not overlap', () => {
  assert.deepEqual(
    SHARED_CLIENT_FIELDS.filter((field) => CONTACT_CLIENT_FIELDS.includes(field)),
    []
  )
  for (const field of ['client_name', 'consultant_name', 'status', 'contract_signed', 'contract_attachments', 'billing_entity']) {
    assert.ok(SHARED_CLIENT_FIELDS.includes(field), `${field} must be shared`)
  }
  for (const field of ['contact_person', 'mobile', 'email', 'designation', 'linkedin', 'connected_on_date', 'comments']) {
    assert.ok(CONTACT_CLIENT_FIELDS.includes(field), `${field} must remain contact-specific`)
  }
})

test('mandates and candidate links are canonicalized to the root in code and migration', () => {
  assert.match(jobController, /payload\.client_id = await assertClientExists\(payload\.client_id\)/)
  assert.match(jobController, /const nextClientId = await assertClientExists\(payload\.client_id \|\| currentJob\.client_id\)/)
  assert.match(candidateController, /payload\.client_id = data\.client_id/)
  assert.match(candidateController, /candidatePayload\.client_id = associationPayload\.client_id/)
  assert.match(migration, /update public\.jobs job[\s\S]*client_id = client\.client_group_id/i)
  assert.match(migration, /update public\.candidate_associations association[\s\S]*client_id = client\.client_group_id/i)
  assert.match(migration, /update public\.candidates candidate[\s\S]*client_id = client\.client_group_id/i)
  assert.match(migration, /trg_00_jobs_root_client_id/i)
  assert.match(migration, /before insert or update of client_id on public\.jobs/i)
})

test('duplicate mandate protection runs before the root move and follow-ups remain contact-specific', () => {
  const duplicateUpdatePosition = migration.indexOf('set duplicate_confirmed = true')
  const rootMovePosition = migration.indexOf('update public.jobs job', duplicateUpdatePosition + 1)
  assert.ok(duplicateUpdatePosition >= 0)
  assert.ok(rootMovePosition > duplicateUpdatePosition)
  assert.doesNotMatch(migration, /update public\.client_follow_ups/i)

  assert.match(clientController, /\.eq\('client_id', req\.params\.id\)/)
  assert.match(clientController, /loadFollowUps\(\[scope\.client\.id\]\)/)
  assert.match(clientsPage, /const followUpClientKey = \(client\) => client\?\.id \|\| ''/)
  assert.match(clientsPage, /const contactOnlyMode = addingContactPerson \|\| editingSecondaryContact/)
})
