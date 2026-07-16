const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const candidatesPage = read('src/pages/CandidatesPage.jsx')
const sharedStyles = read('src/styles/Shared.css')
const reportComponents = read('src/features/reports/ConsultantReportComponents.jsx')

test('resume review overlay leaves the persistent sidebar clickable', () => {
  assert.match(candidatesPage, /className="modal-overlay resume-review-overlay"/)
  assert.match(sharedStyles, /\.modal-overlay\.resume-review-overlay\s*\{[\s\S]*left:\s*var\(--sidebar-width\)/)
  assert.match(sharedStyles, /\.modal-overlay\.resume-review-overlay\s*>\s*\.modal-card\s*\{[\s\S]*position:\s*relative[\s\S]*left:\s*auto/)
})

test('navigating away from resume review cleans pending temporary uploads', () => {
  assert.match(candidatesPage, /useEffect\(\(\) => \(\) => \{[\s\S]*importCancelledRef\.current = true[\s\S]*discardResumeTemps\(importQueueRef\.current\.map/)
  assert.match(candidatesPage, /if \(importCancelledRef\.current\) \{[\s\S]*discardResumeTemps\(rows\.map/)
})

test('report modal only makes the main content inert, not the sidebar', () => {
  assert.match(reportComponents, /document\.querySelector\('\.dashboard-main, \.dashboard-embed'\)/)
  assert.doesNotMatch(reportComponents, /document\.getElementById\('root'\)/)
  assert.match(reportComponents, /appContent\?\.setAttribute\('inert', ''\)/)
})
