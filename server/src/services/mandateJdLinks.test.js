const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  normalizeExternalAttachments,
  normalizeAttachments,
  removalPlan
} = require('./documentAttachments')

const root = path.resolve(__dirname, '../../..')
const controller = fs.readFileSync(path.join(root, 'server/src/controllers/jobController.js'), 'utf8')
const jobsPage = fs.readFileSync(path.join(root, 'src/pages/JobsPage.jsx'), 'utf8')
const clientDetailPage = fs.readFileSync(path.join(root, 'src/pages/ClientDetailPage.jsx'), 'utf8')

test('JD links are normalized as safe external attachments', () => {
  const [attachment] = normalizeExternalAttachments(JSON.stringify([
    { path: 'docs.google.com/document/d/example', name: 'Shared JD' }
  ]), { fieldName: 'jd_links' })

  assert.equal(attachment.path, 'https://docs.google.com/document/d/example')
  assert.equal(attachment.name, 'Shared JD')
  assert.equal(attachment.mime_type, 'text/uri-list')
  assert.throws(
    () => normalizeExternalAttachments(JSON.stringify(['javascript:alert(1)']), { fieldName: 'jd_links' }),
    /valid HTTP or HTTPS link/
  )
})

test('external JD links coexist with files and can be removed without storage deletion', () => {
  const attachments = normalizeAttachments([
    { path: '2026/example.pdf', name: 'Uploaded JD' },
    { path: 'https://example.com/jd', name: 'Linked JD', mime_type: 'text/uri-list' }
  ], { bucket: 'jds' })
  const plan = removalPlan(attachments, JSON.stringify(['https://example.com/jd']), 'jds', 'removed_jd_paths')

  assert.deepEqual(plan.retained.map(item => item.path), ['2026/example.pdf'])
  assert.deepEqual(plan.removed.map(item => item.path), ['https://example.com/jd'])
})

test('mandate create and update persist JD links in the existing attachment collection', () => {
  assert.match(controller, /normalizeExternalAttachments\(req\.body\.jd_links/)
  assert.match(controller, /\[\.\.\.uploadedAttachments, \.\.\.linkedAttachments\]/)
  assert.match(controller, /\[\.\.\.plan\.retained, \.\.\.uploadedAttachments, \.\.\.linkedAttachments\]/)
})

test('Mandates and Client Details open external JD links and show link icons', () => {
  assert.match(jobsPage, /openExternalUrl\(path\)/)
  assert.match(jobsPage, /body\.append\('jd_links', JSON\.stringify\(pendingJdLinks\)\)/)
  assert.match(jobsPage, />Add Link<\/button>/)
  assert.match(jobsPage, /showExternalLinkIcon/)
  assert.match(clientDetailPage, /openExternalUrl\(path\)/)
  assert.match(clientDetailPage, /showExternalLinkIcon/)
})
