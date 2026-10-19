const test = require('node:test')
const assert = require('node:assert/strict')
const { config, authorizationUrl } = require('./crmGmailGoogle')

test('Gmail accepts deployed OAuth names, prefers canonical names, and still validates required configuration', t => {
  const keys = ['GOOGLE_GMAIL_CLIENT_ID', 'GOOGLE_GMAIL_CLIENT_SECRET', 'GoogleOAuthclientID', 'GoogleOAuthclientsecret', 'GOOGLE_GMAIL_REDIRECT_URI', 'GMAIL_TOKEN_ENCRYPTION_KEY']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  t.after(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })
  for (const key of keys) delete process.env[key]
  process.env.GoogleOAuthclientID = 'synthetic-deployed-client'
  process.env.GoogleOAuthclientsecret = 'synthetic-deployed-secret'
  process.env.GOOGLE_GMAIL_REDIRECT_URI = 'https://example.test/api/crm/gmail/callback'
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)

  assert.equal(config().id, 'synthetic-deployed-client')
  assert.equal(config().secret, 'synthetic-deployed-secret')
  const url = new URL(authorizationUrl('synthetic-state', 'consultant@fyndbridge.in', 'synthetic-verifier'))
  assert.equal(url.searchParams.get('client_id'), 'synthetic-deployed-client')
  assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_GMAIL_REDIRECT_URI)
  assert.equal(url.searchParams.has('client_secret'), false)

  process.env.GOOGLE_GMAIL_CLIENT_ID = 'synthetic-canonical-client'
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'synthetic-canonical-secret'
  assert.equal(config().id, 'synthetic-canonical-client')
  assert.equal(config().secret, 'synthetic-canonical-secret')
  delete process.env.GOOGLE_GMAIL_CLIENT_SECRET
  assert.equal(config().secret, 'synthetic-deployed-secret')
  delete process.env.GoogleOAuthclientsecret
  assert.throws(config, { code: 'CONFIGURATION' })

  process.env.GoogleOAuthclientsecret = 'synthetic-deployed-secret'
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'invalid-key'
  assert.throws(config, { code: 'CONFIGURATION' })
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = '01'.repeat(32)
  process.env.GOOGLE_GMAIL_REDIRECT_URI = 'https://example.test/incorrect-callback'
  assert.throws(config, /Invalid Gmail callback configuration/)
})
