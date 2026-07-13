const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const auth = fs.readFileSync(path.join(root, 'src/context/AuthContext.jsx'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src/utils/routePreload.js'), 'utf8')

test('authenticated reload shares one shell loader between preload and React lazy', () => {
  assert.match(preload, /export function loadAuthenticatedShell\(\)/)
  assert.match(app, /const AuthenticatedShell = lazy\(loadAuthenticatedShell\)/)
})

test('authorization keeps the initial skeleton mounted until its route modules are ready', () => {
  assert.match(auth, /preloadAuthenticatedRoute\(initialRouteRef\.current\)/)
  assert.match(auth, /pageViews\.loading \|\| !initialRouteReady/)
})

test('initial route preload covers dashboard, detail, settings, and invoice routes', () => {
  for (const route of [
    '/dashboard',
    '/dashboard/clients/:clientId',
    '/dashboard/clients/:clientId/jobs/:jobId/candidates',
    '/dashboard/settings',
    '/dashboard/profile',
    '/invoice',
    '/invoice/entities/:entityId'
  ]) assert.ok(preload.includes(`'${route}'`), `missing preloader for ${route}`)
})
