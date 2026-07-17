const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260716174816_invoice_cancellation_deletion_number_reuse.sql'), 'utf8')
const baselineSchema = fs.readFileSync(path.join(root, 'server/supabase-invoice-module.sql'), 'utf8')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/invoiceController.js'), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/routes/invoice.js'), 'utf8')

test('invoice lifecycle migration preserves cancelled rows and audit metadata', () => {
  assert.match(migration, /status text not null default 'active'/)
  assert.match(migration, /check \(status in \('active', 'cancelled'\)\)/)
  assert.match(migration, /cancelled_at timestamptz/)
  assert.match(migration, /cancelled_by uuid references auth\.users\(id\) on delete set null/)
  assert.match(controller, /\.update\(\{ status: 'cancelled', cancelled_at: cancelledAt, cancelled_by: req\.user\.id \}\)/)
  const cancelSection = controller.slice(controller.indexOf('async function cancelInvoice'), controller.indexOf('async function deleteInvoice'))
  assert.doesNotMatch(cancelSection, /storage\.from\(STORAGE_BUCKETS\.INVOICE\)\.remove/)
})

test('lowest missing invoice number is allocated inside the exact billing-entity and financial-year series', () => {
  assert.match(migration, /generate_series\([\s\S]*coalesce\([\s\S]*max\(invoice\.sequence_number\)[\s\S]*\) \+ 1/)
  assert.match(migration, /invoice\.billing_entity = p_billing_entity[\s\S]*invoice\.financial_year = p_financial_year/)
  assert.match(migration, /where not exists \([\s\S]*invoice\.sequence_number = candidate\.sequence_number/)
  assert.match(migration, /case when p_billing_entity = 'FCAPL' then 'FCAPL' else 'FB' end/)
  assert.match(baselineSchema, /invoice_type text not null default 'tax_invoice'/)
  assert.match(baselineSchema, /unique \(invoice_type, billing_entity, financial_year, sequence_number\)/)
})

test('concurrent invoice creation is serialized and preview conflicts are rejected atomically', () => {
  const lockIndex = migration.indexOf('pg_catalog.pg_advisory_xact_lock')
  const insertIndex = migration.indexOf('insert into public.invoices')
  assert.ok(lockIndex >= 0)
  assert.ok(insertIndex > lockIndex)
  assert.match(migration, /INVOICE_NUMBER_CHANGED/)
  assert.match(controller, /create_invoice_with_lowest_sequence/)
  assert.match(controller, /p_expected_invoice_number: clean\(expectedNumber\) \|\| null/)
})

test('invoice lifecycle RPCs are service-role only', () => {
  for (const signature of [
    'next_invoice_sequence\\(text, text\\)',
    'next_available_invoice_number\\(text, text\\)',
    'create_invoice_with_lowest_sequence\\(jsonb, text\\)',
    'attach_invoice_pdf\\(uuid, text\\)'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`))
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`))
  }
})

test('entity-scoped cancel and delete routes remain behind the existing admin-only invoice router', () => {
  assert.match(routes, /router\.use\(requireAdmin\)/)
  assert.match(routes, /router\.post\('\/entities\/:entityId\/invoices\/:id\/cancel', controller\.cancelInvoice\)/)
  assert.match(routes, /router\.delete\('\/entities\/:entityId\/invoices\/:id', controller\.deleteInvoice\)/)
  assert.match(controller, /\.eq\('invoice_entity_id', req\.params\.entityId\)/)
})

test('permanent deletion removes all invoice storage paths before deleting the invoice row', () => {
  const storageIndex = controller.indexOf("supabase.storage.from(STORAGE_BUCKETS.INVOICE).remove(storagePaths)")
  const deleteIndex = controller.indexOf(".from('invoices')\n      .delete()", storageIndex)
  assert.ok(storageIndex >= 0)
  assert.ok(deleteIndex > storageIndex)
  assert.match(controller, /invoice\.pdf_storage_path,[\s\S]*versions \|\| \[\]\)\.map\(version => version\.storage_path\)/)
  assert.match(controller, /released: \{ invoice_type: invoice\.invoice_type, billing_entity: invoice\.billing_entity, financial_year: invoice\.financial_year, sequence_number: invoice\.sequence_number \}/)
})
