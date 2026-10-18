const { test: base, expect } = require('@playwright/test')
const express = require('express')
const { AsyncLocalStorage } = require('node:async_hooks')
const fs = require('node:fs/promises')
const path = require('node:path')
const { application, applicationId, USER_ID, memoryDatabase } = require('../test-support/appliedCandidatesMemory.cjs')

let activeDatabase
const databaseContext = new AsyncLocalStorage()
const supabasePath = require.resolve('../src/services/supabaseAdmin')
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, children: [], exports: new Proxy({}, {
  get(target, key) { const database = databaseContext.getStore() || activeDatabase; const value = database[key]; return typeof value === 'function' ? value.bind(database) : value }
}) }
const appliedRouter = require('../src/routes/appliedCandidates')
const preferencesRouter = require('../src/routes/userPreferences')
const attendanceRouter = require('../src/routes/attendance')
const performanceRouter = require('../src/routes/performance')
const evidenceDir = path.resolve(process.env.FYNDBRIDGE_BROWSER_EVIDENCE_DIR || path.join(__dirname, '../../outputs/pms-applied-verification'))

const withApp = async ({ page }, use) => {
    const db = memoryDatabase(Array.from({ length: 105 }, (_, index) => application(index + 1, {
      ...(index === 2 ? { application_status: 'converting', processing_token: 'synthetic-conversion' } : {}),
      internal_job_title_snapshot: 'Finance Manager', client_name_snapshot: 'Example Client', mandate_consultants_snapshot: ['Test Recruiter']
    })))
    activeDatabase = db
    const serverApp = express()
    serverApp.use(express.json())
    serverApp.use((req, res, next) => {
      req.user = { id: USER_ID, email: 'recruiter@fyndbridge.in' }
      const employmentRequest = req.path.startsWith('/api/attendance/') || req.path.startsWith('/api/performance/')
      databaseContext.run(employmentRequest && state.employmentDb ? state.employmentDb : db, next)
    })
    serverApp.use('/api/applied-candidates', appliedRouter)
    serverApp.use('/api/user-preferences', preferencesRouter)
    serverApp.use('/api/attendance', attendanceRouter)
    serverApp.use('/api/performance', performanceRouter)
    const server = serverApp.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const apiBase = `http://127.0.0.1:${server.address().port}`
    const subscriptions = []
    const state = {
      db, superAdmin: true, staff: [{ id: USER_ID, name: 'Test Recruiter', email: 'recruiter@fyndbridge.in', status: 'active' }, { id: applicationId(999), name: 'Test Employee', email: 'employee@fyndbridge.in', status: 'active' }],
      deleteRequests: [], reviewSaves: [], adminSaves: [], preferenceSaves: [], failPreferenceSaves: false, reviews: new Map(), requestPaths: [], consoleErrors: [], dropDeleteResponse: false, performancePermissions: {}, employmentDb: null,
      emitEmploymentStatus(row) {
        for (const { socket, joinRef, topic, changes } of subscriptions) {
          const ids = changes.filter(change => change.table === 'employee_statuses' && ['*', 'UPDATE'].includes(change.event)).map(change => change.id)
          if (ids.length) socket.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', { ids, data: { schema: 'public', table: 'employee_statuses', type: 'UPDATE', commit_timestamp: new Date().toISOString(), columns: Object.keys(row).map(name => ({ name, type: 'text' })), record: row, old_record: { user_id: row.user_id } } }]))
        }
      },
    }
    page.on('pageerror', error => state.consoleErrors.push(error.message))
    await page.addInitScript(({ userId }) => {
      const user = { id: userId, email: 'recruiter@fyndbridge.in', user_metadata: { full_name: 'Test Recruiter' }, aud: 'authenticated', role: 'authenticated' }
      const payload = btoa(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }))
      const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
      navigator.sendBeacon = () => true
      window.__reactCommits = 0
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, renderers: new Map(), inject(renderer) { this.renderers.set(1, renderer); return 1 },
        onCommitFiberRoot() { window.__reactCommits += 1 }, onCommitFiberUnmount() {}, checkDCE() {},
      }
    }, { userId: USER_ID })
    await page.routeWebSocket('**/realtime/**', socket => {
      socket.onMessage(message => {
        try {
          const frame = JSON.parse(String(message))
          const [joinRef, ref, topic, , payload] = frame
          const changes = (payload?.config?.postgres_changes || []).map((change, index) => ({ ...change, id: index + 1 }))
          if (changes.length) subscriptions.push({ socket, joinRef, topic, changes })
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }]))
        } catch { /* Ignore non-JSON synthetic heartbeat frames. */ }
      })
    })
    await page.route('http://127.0.0.1:54321/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.includes('/rest/v1/page_view_permissions')) return route.fulfill({ json: [{ page_key: 'applied_candidates', view_permission: 'everyone' }] })
      if (url.pathname.includes('/auth/v1/user')) return route.fulfill({ json: { id: USER_ID, email: 'recruiter@fyndbridge.in' } })
      return route.fulfill({ json: [] })
    })
    await page.route('**/api/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const routePath = url.pathname
      state.requestPaths.push(routePath)
      if (state.employmentDb && (routePath.startsWith('/api/attendance/') || (routePath.startsWith('/api/performance/') && !routePath.endsWith('/handbook')))) {
        if (routePath.startsWith('/api/performance/') && request.method() === 'PUT') state.reviewSaves.push({ path: routePath, ...request.postDataJSON() })
        return route.fulfill({ response: await route.fetch({ url: `${apiBase}${routePath}${url.search}` }) })
      }
      if (routePath.startsWith('/api/applied-candidates') || routePath.startsWith('/api/user-preferences/')) {
        if (routePath.endsWith('/bulk-delete')) state.deleteRequests.push(request.postDataJSON())
        if (routePath.startsWith('/api/user-preferences/') && request.method() === 'PUT') {
          state.preferenceSaves.push(request.postDataJSON())
          if (state.failPreferenceSaves) return route.fulfill({ status: 500, json: { error: 'Synthetic preference save failure' } })
        }
        const response = await route.fetch({ url: `${apiBase}${routePath}${url.search}` })
        if (routePath.endsWith('/bulk-delete') && state.dropDeleteResponse) { state.dropDeleteResponse = false; return route.abort('failed') }
        return route.fulfill({ response })
      }
      let payload = { data: [] }
      if (routePath === '/api/auth/employment-status') payload = { data: { profile_complete: true, status: 'active' } }
      else if (routePath === '/api/admin/me') payload = { isAdmin: state.superAdmin, isSuperAdmin: state.superAdmin, role: state.superAdmin ? 'super_admin' : 'recruiter' }
      else if (routePath === '/api/user-profiles') payload = { data: { user_id: USER_ID, name: 'Test Recruiter', email: 'recruiter@fyndbridge.in', status: 'active' } }
      else if (routePath === '/api/user-profiles/options') payload = { data: state.employmentDb ? state.employmentDb.tables.user_profiles.map(profile => ({ ...profile, id: profile.user_id, status: state.employmentDb.tables.employee_statuses.find(row => row.user_id === profile.user_id)?.status || 'active' })) : state.staff }
      else if (routePath === '/api/admin/column-permissions') payload = { columns: {}, permissions: { clients: {}, candidates: {}, jobs: {} } }
      else if (routePath === '/api/admin/dashboard-visibility') { const body = request.postDataJSON(); if (body) state.adminSaves.push(body); payload = { data: body || { restrictNonAdminToSelf: true, lowMandateNotificationAudience: 'super_admins' } } }
      else if (routePath === '/api/public/open-roles/count') payload = { count: 8 }
      else if (routePath === '/api/performance/permissions') payload = { permissions: state.performancePermissions }
      else if (routePath === '/api/performance/handbook') payload = { data: null }
      else if (routePath === '/api/performance/completion-statuses') payload = { data: { [USER_ID]: { self: { state: 'complete', filled: 4, total: 4 } } } }
      else if (routePath.startsWith('/api/performance/')) {
        const key = `${routePath}:${url.searchParams.get('period') || request.postDataJSON()?.period}`
        if (request.method() === 'PUT') {
          const body = request.postDataJSON()
          state.reviewSaves.push({ path: routePath, ...body })
          state.reviews.set(key, body.rows)
          payload = { data: { rows: body.rows } }
        } else payload = { data: { rows: state.reviews.get(key) || [] } }
      }
      else if (routePath === '/api/admin/bootstrap') payload = { data: { admin_users: [], columns: {}, permissions: { clients: {}, candidates: {}, jobs: {} }, page_view_permissions: {}, performance_permissions: {} } }
      else if (routePath.includes('/notifications')) payload = { data: [], unreadCount: 0 }
      return route.fulfill({ json: payload })
    })
    await fs.mkdir(evidenceDir, { recursive: true })
    try { await use(state) }
    finally {
      await page.close()
      await new Promise(resolve => server.close(resolve))
    }
}
const test = base.extend({ app: withApp })

module.exports = { test, expect, applicationId, USER_ID, evidenceDir, withApp }
