const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260716174816_invoice_cancellation_deletion_number_reuse.sql'), 'utf8')
const baselineSchema = fs.readFileSync(path.join(root, 'server/supabase-invoice-module.sql'), 'utf8')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/invoiceController.js'), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/routes/invoice.js'), 'utf8')
const invoiceApi = fs.readFileSync(path.join(root, 'src/services/invoiceApi.js'), 'utf8')
const detailPage = fs.readFileSync(path.join(root, 'src/pages/InvoiceEntityDetailPage.jsx'), 'utf8')

test('invoice lifecycle migration preserves cancelled rows and audit metadata', () => {
  assert.match(migration, /status text not null default 'active'/)
  assert.match(migration, /check \(status in \('active', 'cancelled'\)\)/)
  assert.match(migration, /cancelled_at timestamptz/)
  assert.match(migration, /cancelled_by uuid references auth\.users\(id\) on delete set null/)
  assert.match(controller, /\.update\(\{ status: 'cancelled', cancelled_at: cancelledAt, cancelled_by: req\.user\.id \}\)/)
  const cancelSection = controller.slice(controller.indexOf('async function cancelInvoice'), controller.indexOf('module.exports'))
  assert.doesNotMatch(cancelSection, /storage\.from\(STORAGE_BUCKETS\.INVOICE\)\.remove/)
})

test('lowest missing invoice number is allocated inside the exact billing-entity and financial-year series', () => {
  assert.match(migration, /generate_series\([\s\S]*coalesce\([\s\S]*max\(invoice\.sequence_number\)[\s\S]*\) \+ 1/)
  assert.match(migration, /invoice\.billing_entity = p_billing_entity[\s\S]*invoice\.financial_year = p_financial_year/)
  assert.match(migration, /where not exists \([\s\S]*invoice\.sequence_number = candidate\.sequence_number/)
  assert.match(migration, /case when p_billing_entity = 'FCAPL' then 'FCAPL' else 'FB' end/)
  assert.match(baselineSchema, /invoice_type text not null default 'tax_invoice'/)
  assert.match(baselineSchema, /invoices_tax_invoice_sequence_key[\s\S]*\(billing_entity, financial_year, sequence_number\)[\s\S]*where invoice_type = 'tax_invoice'/)
  assert.match(baselineSchema, /invoices_proforma_invoice_sequence_key[\s\S]*\(financial_year, sequence_number\)[\s\S]*where invoice_type = 'proforma_invoice'/)
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

test('entity-scoped cancellation remains admin-only and permanent invoice deletion is not exposed', () => {
  assert.match(routes, /router\.use\(requireAdmin\)/)
  assert.match(routes, /router\.post\('\/entities\/:entityId\/invoices\/:id\/cancel', controller\.cancelInvoice\)/)
  assert.match(controller, /\.eq\('invoice_entity_id', req\.params\.entityId\)/)
  assert.doesNotMatch(routes, /router\.delete\('\/entities\/:entityId\/invoices\/:id'/)
  assert.doesNotMatch(routes, /router\.delete\('\/invoice-pdf-versions\/:id'/)
  assert.doesNotMatch(controller, /async function deleteInvoice\(/)
  assert.doesNotMatch(controller, /async function deletePdfVersion\(/)
  assert.doesNotMatch(invoiceApi, /export const deleteInvoice =/)
  assert.doesNotMatch(invoiceApi, /export const deleteInvoicePdfVersion =/)
  assert.doesNotMatch(detailPage, /invoice-delete-action|invoice-version-delete|Delete invoice permanently|Delete this PDF version|openAction\('delete'/)
})
