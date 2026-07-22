const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const multer = require('multer')

process.env.SUPABASE_URL ||= 'https://unit-test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-service-role-key'

const {
  MAX_PUBLIC_RESUME_BYTES,
  PDF_MIME_TYPE,
  publicApplicationUpload,
  publicResumeFileFilter,
  cleanupPublicResume,
  hasPdfSignature,
  validatePublicResume,
  handlePublicUploadErrors
} = require('../middleware/publicApplicationUpload')
const { publicRouteErrorHandler } = require('../controllers/publicRolesController')

function runFileFilter(file) {
  return new Promise((resolve) => {
    publicResumeFileFilter({}, file, (error, accepted) => resolve({ error, accepted }))
  })
}

async function runMultipartUpload(contents, {
  filename = 'resume.pdf',
  mimetype = PDF_MIME_TYPE
} = {}) {
  const boundary = '----fyndbridge-public-resume-test-boundary'
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="resume"; filename="${filename}"\r\n` +
    `Content-Type: ${mimetype}\r\n\r\n`
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([prefix, contents, suffix])
  const req = new PassThrough()
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length)
  }
  req.method = 'POST'
  req.url = '/api/public/open-roles/parse-resume'

  const error = await new Promise((resolve) => {
    publicApplicationUpload.single('resume')(req, {}, resolve)
    req.end(body)
  })
  return { req, error }
}

function runResumeValidation(file) {
  const req = { file }
  return new Promise((resolve) => {
    validatePublicResume(req, {}, (error) => resolve({ error, req }))
  })
}

test('public resume upload accepts exactly one MiB and rejects one byte more', async (t) => {
  assert.equal(MAX_PUBLIC_RESUME_BYTES, 1024 * 1024)

  const exactContents = Buffer.alloc(MAX_PUBLIC_RESUME_BYTES, 0x20)
  exactContents.set(Buffer.from('%PDF-'))
  const exact = await runMultipartUpload(exactContents)
  t.after(async () => cleanupPublicResume(exact.req.file))

  assert.equal(exact.error, undefined)
  assert.equal(exact.req.file.size, MAX_PUBLIC_RESUME_BYTES)
  assert.equal(await hasPdfSignature(exact.req.file), true)

  const oversizedContents = Buffer.alloc(MAX_PUBLIC_RESUME_BYTES + 1, 0x20)
  oversizedContents.set(Buffer.from('%PDF-'))
  const oversized = await runMultipartUpload(oversizedContents)

  assert.equal(oversized.error?.name, 'MulterError')
  assert.equal(oversized.error?.code, 'LIMIT_FILE_SIZE')
  assert.equal(oversized.req.file, undefined)
})

test('public resume filter requires both a case-insensitive .pdf extension and exact PDF MIME', async () => {
  const accepted = await runFileFilter({ originalname: 'Candidate.CV.PDF', mimetype: PDF_MIME_TYPE })
  assert.equal(accepted.error, null)
  assert.equal(accepted.accepted, true)

  const wrongExtension = await runFileFilter({ originalname: 'Candidate.CV.docx', mimetype: PDF_MIME_TYPE })
  assert.equal(wrongExtension.error?.code, 'INVALID_PUBLIC_RESUME')
  assert.equal(wrongExtension.accepted, undefined)

  const wrongMime = await runFileFilter({ originalname: 'Candidate.CV.pdf', mimetype: 'application/octet-stream' })
  assert.equal(wrongMime.error?.code, 'INVALID_PUBLIC_RESUME')
  assert.equal(wrongMime.accepted, undefined)
})

test('signature validation requires %PDF- at byte zero and removes an invalid staged file', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'public-resume-signature-'))
  t.after(async () => fs.rm(directory, { recursive: true, force: true }))

  const validPath = path.join(directory, 'valid.pdf')
  const shiftedPath = path.join(directory, 'shifted.pdf')
  await fs.writeFile(validPath, Buffer.from('%PDF-1.7\ncontent'))
  await fs.writeFile(shiftedPath, Buffer.from('\n%PDF-1.7\ncontent'))

  assert.equal(await hasPdfSignature({ path: validPath }), true)
  assert.equal(await hasPdfSignature({ path: shiftedPath }), false)

  const result = await runResumeValidation({ path: shiftedPath })
  assert.equal(result.error?.code, 'INVALID_PUBLIC_RESUME')
  assert.equal(result.req.file, undefined)
  await assert.rejects(fs.access(shiftedPath), { code: 'ENOENT' })
})

test('upload error handler returns the fixed one-MiB public error without leaking internals', async () => {
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
  const error = new multer.MulterError('LIMIT_FILE_SIZE', 'resume')

  await handlePublicUploadErrors(error, {}, response, () => assert.fail('error must be handled'))

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.body, { error: 'Resume PDF must be 1 MB or smaller.' })
})

test('resume validation errors stay public-safe through the terminal public route handler', async () => {
  const result = await runResumeValidation(undefined)
  const response = {
    headersSent: false,
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }

  publicRouteErrorHandler(result.error, {}, response, () => assert.fail('error must be handled'))

  assert.equal(result.error?.publicSafe, true)
  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.body, { error: 'Resume PDF is required.' })
})
