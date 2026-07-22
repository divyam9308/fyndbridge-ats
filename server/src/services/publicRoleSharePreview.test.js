const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildPublicRoleShareHtml, publicExperienceLabel } = require('./publicRoleSharePreview')

const root = path.resolve(__dirname, '../../..')

test('public role share preview exposes role, location and experience metadata only', () => {
  const html = buildPublicRoleShareHtml({
    slug: 'finance-lead-jb100',
    public_name: 'Finance <Lead>',
    public_location: 'Mumbai & Pune',
    public_experience: '8 - 12 Years'
  }, 'https://careers.example.com')

  assert.match(html, /property="og:title" content="Finance &lt;Lead&gt;"/)
  assert.match(html, /property="og:description" content="Location: Mumbai &amp; Pune · Experience: 8 - 12 Years"/)
  assert.match(html, /name="twitter:description" content="Location: Mumbai &amp; Pune · Experience: 8 - 12 Years"/)
  assert.doesNotMatch(html, /(?:og:image|twitter:image|summary_large_image)/)
  assert.match(html, /https:\/\/careers\.example\.com\/open-roles\/finance-lead-jb100/)
  assert.doesNotMatch(html, /<Lead>/)
})

test('experience preview labels make bare numeric ranges explicit without duplicating years', () => {
  assert.equal(publicExperienceLabel('10-15'), '10-15 Years')
  assert.equal(publicExperienceLabel('8 - 12 Years'), '8 - 12 Years')
})

test('copied mandate links use the preview route while direct preview keeps the public role page', () => {
  const jobsPage = fs.readFileSync(path.join(root, 'src/pages/JobsPage.jsx'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'server/src/app.js'), 'utf8')
  const routes = fs.readFileSync(path.join(root, 'server/src/routes/publicRoles.js'), 'utf8')
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))

  assert.match(jobsPage, /publicRoleShareUrl[\s\S]*\/share\/open-roles\//)
  assert.match(jobsPage, /text-only-v1-/)
  assert.match(jobsPage, /\?v=\$\{encodeURIComponent\(previewVersion\)\}/)
  assert.match(jobsPage, /clipboard\.writeText\(publicRoleShareUrl\(job\)\)/)
  assert.match(jobsPage, /showPublicActionNotice\('Link copied', 'success'\)/)
  assert.match(jobsPage, /publicActionNotice && createPortal\([\s\S]*document\.body/)
  assert.match(jobsPage, /window\.open\(publicRoleUrl\(job\)/)
  assert.match(app, /app\.get\('\/share\/open-roles\/:slug', require\('\.\/controllers\/publicRolesController'\)\.shareOpenRole\)/)
  assert.match(routes, /router\.get\('\/open-roles\/:slug\/share', controller\.shareOpenRole\)/)
  assert.ok(vercel.rewrites.some(rewrite => rewrite.source === '/share/open-roles/:slug' && rewrite.destination === '/api/public/open-roles/:slug/share'))
})
