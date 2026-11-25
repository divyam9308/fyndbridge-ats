const dns = require('node:dns').promises
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3

// Do not allow internal, non-routable, metadata-service or reserved addresses.
const DENIED_IPV4 = new net.BlockList()
for (const [base, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) DENIED_IPV4.addSubnet(base, prefix, 'ipv4')

const GLOBAL_IPV6 = new net.BlockList()
GLOBAL_IPV6.addSubnet('2000::', 3, 'ipv6')
const DENIED_IPV6 = new net.BlockList()
for (const [base, prefix] of [
  ['2001::', 32], // Teredo tunnels
  ['2001:db8::', 32], // Documentation range
  ['2001:10::', 28], ['2001:20::', 28], // ORCHID
  ['2002::', 16] // 6to4 tunnels
]) DENIED_IPV6.addSubnet(base, prefix, 'ipv6')

function unsafeUrl(message = 'Resume URL must resolve to a public internet address') {
  const error = new Error(message)
  error.statusCode = 400
  error.code = 'UNSAFE_RESUME_URL'
  return error
}

function isPublicIp(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '')
  const family = net.isIP(ip)
  if (family === 4) return !DENIED_IPV4.check(ip, 'ipv4')
  if (family === 6) return GLOBAL_IPV6.check(ip, 'ipv6') && !DENIED_IPV6.check(ip, 'ipv6')
  return false
}

function validatePublicUrl(input) {
  let url
  try { url = new URL(input) } catch { throw unsafeUrl('A valid resume URL is required') }
  if (!['https:', 'http:'].includes(url.protocol)) throw unsafeUrl('Only HTTP(S) resume URLs are supported')
  if (url.username || url.password) throw unsafeUrl('Resume URLs cannot contain credentials')
  if (!url.hostname) throw unsafeUrl('Resume URL is missing a hostname')
  if (url.port && !['80', '443'].includes(url.port)) throw unsafeUrl('Resume URL uses an unsupported port')
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicIp(url.hostname)) throw unsafeUrl()
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw unsafeUrl()
  return url
}

// Resolve each outbound connection through an address-allowing lookup.
// This avoids DNS-rebinding between initial URL validation and the request.
function createPublicLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {} }
    const opts = typeof options === 'number' ? { family: options } : (options || {})
    Promise.resolve().then(async () => {
      const addresses = net.isIP(hostname)
        ? [{ address: hostname, family: net.isIP(hostname) }]
        : await resolve(hostname, { all: true, verbatim: true })
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(x => !isPublicIp(x.address))) throw unsafeUrl()
      const matching = opts.family ? addresses.filter(x => x.family === opts.family) : addresses
      if (!matching.length) throw unsafeUrl('No public address available for this address family')
      if (opts.all) return callback(null, matching)
      return callback(null, matching[0].address, matching[0].family)
    }).catch(error => callback(error))
  }
}

// The caller receives bytes only, and remains responsible for temporary-file cleanup.
// Request injection is used solely for deterministic tests; production uses Axios.
async function downloadPublicPdf(input, { request, resolve = dns.lookup } = {}) {
  const httpGet = request || ((url, options) => require('axios').get(url, options))
  const lookup = createPublicLookup(resolve)
  const httpAgent = new http.Agent({ lookup })
  const httpsAgent = new https.Agent({ lookup })
  let target = validatePublicUrl(input)
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await httpGet(target.href, {
        responseType: 'arraybuffer',
        maxContentLength: MAX_PDF_BYTES,
        timeout: 30000,
        maxRedirects: 0,
        decompress: false,
        proxy: false,
        httpAgent,
        httpsAgent,
        headers: { 'Accept-Encoding': 'identity' },
        validateStatus: () => true
      })
      if (response.status >= 300 && response.status < 400) {
        if (redirects === MAX_REDIRECTS) throw unsafeUrl('Resume URL exceeded the redirect limit')
        const location = response.headers?.location
        if (!location) throw unsafeUrl('Resume URL redirect has no destination')
        target = validatePublicUrl(new URL(location, target).href)
        continue
      }
      if (response.status !== 200) throw unsafeUrl('Resume URL returned HTTP ' + response.status)
      const encoding = String(response.headers?.['content-encoding'] || 'identity').toLowerCase()
      if (encoding !== 'identity') throw unsafeUrl('Compressed resume responses are not supported')
      const type = String(response.headers?.['content-type'] || '').toLowerCase()
      if (!type.includes('application/pdf')) throw unsafeUrl('URL does not point to a PDF')
      const bytes = Buffer.from(response.data)
      if (bytes.length > MAX_PDF_BYTES) throw unsafeUrl('Resume PDF must be 10 MB or smaller')
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw unsafeUrl('Resume URL did not return a valid PDF')
      return bytes
    }
    throw unsafeUrl('Resume URL exceeded the redirect limit')
  } finally {
    httpAgent.destroy()
    httpsAgent.destroy()
  }
}

module.exports = { downloadPublicPdf, validatePublicUrl, createPublicLookup, isPublicIp }
