const { getDocumentFileMeta } = require('./documentFile')
// Layout-preserving conversion runs in a private Gotenberg service, not a text renderer.
async function convertWordToPdf(buffer, originalName) {
  const configured = process.env.CV_WORD_CONVERTER_URL
  if (!configured) throw Object.assign(new Error('Word CV conversion is not configured. Please upload a PDF CV.'), { code: 'WORD_CONVERTER_REQUIRED', statusCode: 400 })
  const url = new URL(configured)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Word converter configuration.')
  const meta = getDocumentFileMeta({ originalname: originalName })
  const body = new FormData()
  body.append('files', new Blob([buffer], { type: meta.contentType }), `cv.${meta.extension}`)
  const response = await fetch(new URL('forms/libreoffice/convert', `${url.href.replace(/\/$/, '')}/`), {
    method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: process.env.CV_WORD_CONVERTER_TOKEN ? { Authorization: `Bearer ${process.env.CV_WORD_CONVERTER_TOKEN}` } : {}
  })
  if (!response.ok) throw new Error('Word CV conversion failed. Please retry or upload a PDF.')
  const reader = response.body.getReader()
  const chunks = []; let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('The converted PDF is too large.') }
    chunks.push(Buffer.from(value))
  }
  const bytes = Buffer.concat(chunks)
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The Word converter did not return a PDF.')
  return bytes
}
module.exports = { convertWordToPdf }
