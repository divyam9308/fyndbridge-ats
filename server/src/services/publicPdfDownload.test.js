const test = require('node:test')
const assert = require('node:assert/strict')
const { downloadPublicPdf, validatePublicUrl, createPublicLookup, isPublicIp } = require('./publicPdfDownload')

const pdf = Buffer.from('%PDF-1.7\nhello')
const pdfResponse = (overrides = {}) => ({
  status: 200, headers: { 'content-type': 'application/pdf' }, data: pdf, ...overrides
})

test('rejects private, reserved, mapped and local addresses', () => {
  const invalid = ['127.0.0.1', '127.0.5.1', '10.1.2.3', '172.31.5.9',
    '192.168.1.10', '169.254.169.254', '100.64.12.1', '0.0.0.0',
    '198.18.1.1', '224.0.0.1', '::1', 'fc00::1',
    'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']
  for (const ip of invalid) assert.equal(isPublicIp(ip), false, ip)
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPublicIp(ip), true, ip)
  }
})

test('rejects unusual private IP URL representations and credentials', () => {
  for (const url of ['http://127.1/a.pdf', 'http://2130706433/a.pdf',
    'http://0x7f000001/a.pdf', 'http://[::ffff:127.0.0.1]/a.pdf',
    'http://localhost/a.pdf', 'http://x.local/a.pdf',
    'http://user:pass@example.com/a.pdf', 'http://8.8.8.8:8080/a.pdf',
    'file:///etc/passwd']) {
    assert.throws(() => validatePublicUrl(url), { code: 'UNSAFE_RESUME_URL' }, url)
  }
})

test('DNS lookup rejects mixed public/private answers', async () => {
  const lookup = createPublicLookup(async () =>
    [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])
  const request = new Promise((resolve, reject) =>
    lookup('cv.example.com', {}, (error, ip) => error ? reject(error) : resolve(ip)))
  await assert.rejects(request, /public internet address/)
})

test('DNS lookup selects a vetted address', async () => {
  const lookup = createPublicLookup(async () => [{ address: '8.8.8.8', family: 4 }])
  const result = await new Promise((resolve, reject) =>
    lookup('cv.example.com', {}, (error, address, family) =>
      error ? reject(error) : resolve({ address, family })))
  assert.deepEqual(result, { address: '8.8.8.8', family: 4 })
})

test('normal PDF succeeds with restricted Axios options', async () => {
  const result = await downloadPublicPdf('https://docs.example.com/cv.pdf', {
    request: async (url, options) => {
      assert.equal(options.proxy, false)
      assert.equal(options.maxRedirects, 0)
      assert.equal(options.decompress, false)
      assert.equal(options.maxContentLength, 10 * 1024 * 1024)
      assert.equal(options.headers['Accept-Encoding'], 'identity')
      return pdfResponse()
    }
  })
  assert.deepEqual(result, pdf)
})

test('cross-origin redirects are manually validated', async () => {
  const calls = []
  const result = await downloadPublicPdf('https://source.example.org/a', {
    request: async url => {
      calls.push(url)
      if (calls.length === 1) return pdfResponse({
        status: 302, headers: { location: 'https://cdn.example.org/cv.pdf' }
      })
      return pdfResponse()
    }
  })
  assert.deepEqual(calls, ['https://source.example.org/a', 'https://cdn.example.org/cv.pdf'])
  assert.deepEqual(result, pdf)
})

test('redirects to cloud metadata addresses are blocked', async () => {
  let calls = 0
  await assert.rejects(downloadPublicPdf('https://source.example.org/a', {
    request: async () => {
      calls++
      return pdfResponse({
        status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }
      })
    }
  }), { code: 'UNSAFE_RESUME_URL' })
  assert.equal(calls, 1)
})

test('oversized, compressed and non-PDF responses fail', async () => {
  const cases = [
    pdfResponse({ headers: { 'content-type': 'application/pdf', 'content-encoding': 'br' } }),
    pdfResponse({ headers: { 'content-type': 'text/html' } }),
    pdfResponse({ data: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    pdfResponse({ data: Buffer.from('<html></html>') })
  ]
  for (const response of cases) {
    await assert.rejects(downloadPublicPdf('https://example.com/cv.pdf', {
      request: async () => response
    }), { code: 'UNSAFE_RESUME_URL' })
  }
})
