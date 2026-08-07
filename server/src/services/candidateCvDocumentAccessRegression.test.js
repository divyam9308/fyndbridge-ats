const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const clientDetailPage = fs.readFileSync(path.join(root, 'src/pages/ClientDetailPage.jsx'), 'utf8')
const clientJobCandidatesPage = fs.readFileSync(path.join(root, 'src/pages/ClientJobCandidatesPage.jsx'), 'utf8')
const candidateUtils = fs.readFileSync(path.join(root, 'src/utils/candidateUtils.js'), 'utf8')
const apiClient = fs.readFileSync(path.join(root, 'src/services/apiClient.js'), 'utf8')
const documentAccess = fs.readFileSync(path.join(root, 'server/src/services/documentAccess.js'), 'utf8')

test('client candidate CV links authorize with candidates.id while retaining association UI keys', () => {
  assert.match(candidateUtils, /candidateId: row\.candidate_id/)
  assert.match(apiClient, /if \(options\.recordId\) params\.set\('record_id', String\(options\.recordId\)\)/)

  for (const source of [clientDetailPage, clientJobCandidatesPage]) {
    assert.match(source, /openDocument = (?:useCallback\()?async \(key, path, recordId\)/)
    assert.match(source, /openProtectedDocumentPath\('cv', path, \{\s*recordId,/)
  }

  assert.match(clientDetailPage, /openDocument\(docKey, cvHref, c\.candidateId\)/)
  assert.match(clientJobCandidatesPage, /openDocument\(`cv-\$\{c\.associationId \|\| c\.id\}`, resolveCandidateCvHref\(c\), c\.candidateId\)/)
})

test('protected CV access still requires candidates.id and verifies path ownership', () => {
  assert.match(documentAccess, /if \(!recordId\) \{[\s\S]*?A record ID is required to open this document\./)
  assert.match(documentAccess, /\.from\(scope\.table\)[\s\S]*?\.eq\('id', recordId\)/)
  assert.match(documentAccess, /attachments\.some\(attachment => attachment\.path === path\)/)
})
