const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const clientDetailPage = fs.readFileSync(path.join(root, 'src/pages/ClientDetailPage.jsx'), 'utf8')

test('Client Details places JD between mandate name and status', () => {
  assert.match(
    clientDetailPage,
    /<th>Mandate \/ Role<\/th>\s*<th>JD<\/th>\s*<th>Status<\/th>/
  )
})

test('Client Details displays the JD from each related job without per-row requests', () => {
  assert.match(clientDetailPage, /normalizeAttachments\(job\?\.jd_attachments,\s*\{[\s\S]*?jd_storage_path \|\| job\?\.jd_url/)
  assert.match(clientDetailPage, /attachments=\{jobJdAttachments\(group\.relatedJob\)\}/)
  assert.match(clientDetailPage, /client-detail-jd-\$\{group\.relatedJob\?\.id \|\| group\.key\}/)
  assert.match(clientDetailPage, /fetch\(`\/api\/jobs\?client_id=\$\{clientId\}&all=true`\)/)
  assert.doesNotMatch(clientDetailPage, /jobGroups\.map\([\s\S]{0,1200}fetch\(/)
})

test('Client Details uses the existing protected JD interaction and refreshes on job changes', () => {
  assert.match(clientDetailPage, /openProtectedDocumentPath\('jd', path,\s*\{[\s\S]*?recordId: jobId/)
  assert.match(clientDetailPage, /tables: \['clients', 'client_follow_ups', 'jobs'\]/)
})
