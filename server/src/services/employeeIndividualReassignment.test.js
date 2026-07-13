const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { normalizeCategorySelection, normalizeSelections } = require('./employeeReassignmentUtils')

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260713110119_employee_individual_reassignment.sql'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'src/features/employee-management/EmployeeManagement.jsx'), 'utf8')
const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8')
const selectionModule = import(pathToFileURL(path.join(root, 'src/features/employee-management/reassignmentSelection.js')).href)
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`

test('backend normalizes individual and independent category selections', () => {
  const result = normalizeSelections({
    clients: { mode: 'selected', selectedIds: [id(1), id(2), id(2)] },
    mandates: { mode: 'selected', selected_ids: [id(3)] },
    candidates: { mode: 'none' }
  })
  assert.deepEqual(result.clients.selected_ids, [id(1), id(2)])
  assert.deepEqual(result.mandates.selected_ids, [id(3)])
  assert.deepEqual(result.candidates, { mode: 'none', selected_ids: [], excluded_ids: [] })
})

test('Select All uses exclusions without sending every record ID', () => {
  assert.deepEqual(normalizeCategorySelection({ mode: 'all', excludedIds: [id(4), id(4)] }, 'clients'), {
    mode: 'all', selected_ids: [], excluded_ids: [id(4)]
  })
  assert.throws(() => normalizeCategorySelection({ mode: 'all', selectedIds: [id(1)] }, 'clients'), /cannot contain selected IDs/)
})

test('invalid modes, IDs and empty selections are rejected before the RPC', () => {
  assert.throws(() => normalizeCategorySelection({ mode: 'everything' }, 'clients'), /Invalid clients selection mode/)
  assert.throws(() => normalizeCategorySelection({ mode: 'selected', selectedIds: ['not-a-uuid'] }, 'clients'), /invalid record ID/)
  assert.throws(() => normalizeSelections({ clients: { mode: 'none' } }), /Select at least one record/)
})

test('frontend selection supports checked, indeterminate, clear and search-safe state', async () => {
  const { createEmptySelections, isRecordSelected, selectedRecordCount, selectAllState, toggleAllSelection, toggleRecordSelection } = await selectionModule
  const empty = createEmptySelections()
  let clients = toggleRecordSelection(empty.clients, id(1), true)
  clients = toggleRecordSelection(clients, id(2), true)
  assert.equal(selectedRecordCount(clients, 5), 2)
  assert.deepEqual(selectAllState(clients, 5), { checked: false, indeterminate: true })
  assert.equal(isRecordSelected(clients, id(1)), true)
  assert.equal(isRecordSelected(clients, id(3)), false)

  clients = toggleAllSelection(true)
  assert.deepEqual(selectAllState(clients, 5), { checked: true, indeterminate: false })
  clients = toggleRecordSelection(clients, id(4), false)
  assert.equal(selectedRecordCount(clients, 5), 4)
  assert.deepEqual(selectAllState(clients, 5), { checked: false, indeterminate: true })
  assert.equal(isRecordSelected(clients, id(4)), false)
  assert.deepEqual(toggleAllSelection(false), { mode: 'none', selectedIds: [], excludedIds: [] })

  // Filtering displayed rows never mutates the independent selection object.
  const beforeSearch = JSON.stringify(clients)
  const displayedAfterSearch = [id(2)].filter(recordId => isRecordSelected(clients, recordId))
  assert.deepEqual(displayedAfterSearch, [id(2)])
  assert.equal(JSON.stringify(clients), beforeSearch)
})

test('each category has independent whole-category Select All semantics', async () => {
  const { createEmptySelections, selectedRecordCount, toggleAllSelection, toggleRecordSelection } = await selectionModule
  const selections = createEmptySelections()
  selections.clients = toggleAllSelection(true)
  selections.mandates = toggleRecordSelection(selections.mandates, id(7), true)
  selections.candidates = toggleAllSelection(true)
  assert.deepEqual([
    selectedRecordCount(selections.clients, 9),
    selectedRecordCount(selections.mandates, 4),
    selectedRecordCount(selections.candidates, 12)
  ], [9, 1, 12])
})

test('fresh record reads are paginated, searchable and restricted to the current source', () => {
  assert.match(migration, /create or replace function public\.employee_reassignment_records/i)
  assert.match(migration, /p_search text default ''[\s\S]*p_offset integer default 0[\s\S]*p_limit integer default 50/i)
  assert.match(migration, /limit greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/i)
  assert.match(migration, /client\.consultant_user_id::text = p_employee_id/i)
  assert.match(migration, /lower\(btrim\(coalesce\(job\.team_lead, ''\)\)\) = lower\(source_name\)/i)
  assert.match(migration, /association\.consultant_user_id::text = p_employee_id/i)
  assert.match(ui, /fetchEmployeeReassignmentRecords\(source\.id, category/)
  assert.match(ui, /key=\{reassignSource\.id\}/)
})

test('the atomic RPC rejects stale ownership and updates only resolved IDs', () => {
  assert.match(migration, /p_selections jsonb/i)
  assert.match(migration, /client\.id = any\(client_ids\)/i)
  assert.match(migration, /job\.id = any\(mandate_ids\)/i)
  assert.match(migration, /association\.id = any\(candidate_ids\)/i)
  assert.match(migration, /if owned_count <> expected_count then[\s\S]*no longer assigned/i)
  assert.match(migration, /if client_total <> expected_count then/i)
  assert.match(migration, /if mandate_total <> expected_count then/i)
  assert.match(migration, /if candidate_total <> expected_count then/i)
  assert.match(migration, /distinct on \(lower\(btrim\(replaced\.value\)\)\)/i)
  assert.match(migration, /team_lead = case when[\s\S]*then destination_name else job\.team_lead end/i)
  assert.match(migration, /return jsonb_build_object\([\s\S]*'clients', client_total[\s\S]*'mandates', mandate_total[\s\S]*'candidates', candidate_total/i)
})

test('reassignment keeps existing Super Admin authorization and valid destinations', () => {
  assert.match(routes, /reassignment-records', requireSuperAdmin/)
  assert.match(routes, /reassign', requireSuperAdmin/)
  assert.match(migration, /admin_user\.role = 'super_admin'/i)
  assert.match(migration, /destination_status <> 'active'/i)
  assert.match(ui, /employee\.id !== source\.id && employee\.status === 'active'/)
})

test('reassignment adds no notification behavior or database writes', () => {
  const scoped = [migration, ui].join('\n')
  assert.doesNotMatch(scoped, /notification helper|notifyReviewer|sendNotification|insert\s+into\s+public\.notifications/i)
  assert.doesNotMatch(migration, /update\s+public\.notifications|delete\s+from\s+public\.notifications/i)
})
