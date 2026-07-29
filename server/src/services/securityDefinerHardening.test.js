const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260729190656_harden_security_definer_function_access.sql'),
  'utf8'
)
const candidateSchema = fs.readFileSync(
  path.join(root, 'server/supabase-candidate-associations.sql'),
  'utf8'
)
const invoiceSchema = fs.readFileSync(
  path.join(root, 'server/supabase-invoice-module.sql'),
  'utf8'
)
const invoiceController = fs.readFileSync(
  path.join(root, 'server/src/controllers/invoiceController.js'),
  'utf8'
)

test('trigger-only security definer functions are not callable through API roles', () => {
  assert.match(
    migration,
    /revoke all on function public\.handle_new_user\(\)[\s\S]*from public, anon, authenticated, service_role/i
  )
  assert.match(
    migration,
    /revoke all on function public\.rls_auto_enable\(\)[\s\S]*from public, anon, authenticated, service_role/i
  )
  assert.match(
    candidateSchema,
    /revoke all on function public\.handle_new_user\(\)[\s\S]*from public, anon, authenticated, service_role/i
  )
})

test('invoice display ID allocation is service-role only', () => {
  for (const sql of [migration, invoiceSchema]) {
    assert.match(
      sql,
      /revoke all on function (?:public\.)?next_invoice_display_id\(\)[\s\S]*from public, anon, authenticated, service_role/i
    )
    assert.match(
      sql,
      /grant execute on function (?:public\.)?next_invoice_display_id\(\)[\s\S]*to service_role/i
    )
  }
  assert.match(invoiceController, /require\('\.\.\/services\/supabaseAdmin'\)/)
  assert.match(invoiceController, /supabase\.rpc\('next_invoice_display_id'\)/)
})

test('employee activity lookup is private and denies accounts without a status row', () => {
  assert.match(migration, /create schema if not exists private/i)
  assert.match(migration, /create or replace function private\.is_current_employee_active\(\)/i)
  assert.match(migration, /where user_id = \(select auth\.uid\(\)\)::text[\s\S]*\), false\)/i)
  assert.match(
    migration,
    /grant execute on function private\.is_current_employee_active\(\)[\s\S]*to authenticated/i
  )
  assert.match(
    migration,
    /alter policy employee_statuses_authenticated_read[\s\S]*select private\.is_current_employee_active\(\)/i
  )
  assert.match(
    migration,
    /alter policy page_view_permissions_select_authenticated[\s\S]*select private\.is_current_employee_active\(\)/i
  )
  assert.match(migration, /drop function public\.is_current_employee_active\(\)/i)
})

test('automatic RLS event trigger is fully tracked by the migration', () => {
  assert.match(migration, /create or replace function public\.rls_auto_enable\(\)/i)
  assert.match(migration, /returns event_trigger/i)
  assert.match(migration, /alter table if exists %s enable row level security/i)
  assert.match(migration, /drop event trigger if exists ensure_rls/i)
  assert.match(
    migration,
    /create event trigger ensure_rls[\s\S]*on ddl_command_end[\s\S]*execute function public\.rls_auto_enable\(\)/i
  )
})
