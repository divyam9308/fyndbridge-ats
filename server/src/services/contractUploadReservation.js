const crypto = require('crypto')
const supabase = require('./supabaseAdmin')
const { STORAGE_BUCKETS } = require('./storageBuckets')
const { normalizeAttachments, parseArray } = require('./documentAttachments')

const MAX_CONTRACT_SIZE = 10 * 1024 * 1024
const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000

function clean(value) {
  return String(value ?? '').trim()
}

function safeBaseName(value) {
  return clean(value || 'contract.pdf')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'contract'
}

function signingSecret() {
  const secret = process.env.CONTRACT_UPLOAD_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Contract upload signing secret is not configured.')
  return secret
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url')
}

function reservationToken(payload) {
  const encoded = encode(payload)
  return `${encoded}.${sign(encoded)}`
}

function decodeReservation(token) {
  const [encoded, signature, extra] = clean(token).split('.')
  if (!encoded || !signature || extra) throw Object.assign(new Error('Invalid contract upload reservation.'), { statusCode: 400 })
  const expected = sign(encoded)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw Object.assign(new Error('Invalid contract upload reservation.'), { statusCode: 400 })
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid contract upload reservation.'), { statusCode: 400 })
  }
  if (!payload?.exp || payload.exp < Date.now()) {
    throw Object.assign(new Error('Contract upload reservation has expired. Please select the files again.'), { statusCode: 400 })
  }
  return payload
}

function validateFiles(rawFiles) {
  const files = parseArray(rawFiles, 'files')
  if (!files.length) throw Object.assign(new Error('Select at least one contract PDF.'), { statusCode: 400 })
  if (files.length > 20) throw Object.assign(new Error('Select up to 20 contract PDFs at once.'), { statusCode: 400 })
  return files.map((file) => {
    const name = clean(file?.name)
    const size = Number(file?.size)
    if (!name || !name.toLowerCase().endsWith('.pdf')) {
      throw Object.assign(new Error(`${name || 'Contract document'}: Contract document must be a PDF file.`), { statusCode: 400 })
    }
    if (!Number.isFinite(size) || size < 0 || size > MAX_CONTRACT_SIZE) {
      throw Object.assign(new Error(`${name}: Contract document must be 10 MB or smaller.`), { statusCode: 400 })
    }
    return { name, size, mime_type: 'application/pdf' }
  })
}

async function createContractUploadReservation({ userId, recordId = '', files }) {
  if (!userId) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  const validated = validateFiles(files)
  const scopeId = clean(recordId) || crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const reservedFiles = validated.map(file => ({
    ...file,
    path: `contracts/${scopeId}/${crypto.randomUUID()}-${safeBaseName(file.name)}.pdf`,
    uploaded_at: createdAt
  }))
  const uploads = []
  for (const file of reservedFiles) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKETS.CONTRACT).createSignedUploadUrl(file.path)
    if (error || !data?.token) throw error || new Error('Unable to prepare contract upload.')
    uploads.push({ ...file, token: data.token })
  }
  const reservation = reservationToken({
    version: 1,
    user_id: userId,
    record_id: clean(recordId),
    exp: Date.now() + RESERVATION_TTL_MS,
    files: reservedFiles
  })
  return { reservation, uploads }
}

function verifyContractUploadReservation({ token, userId, recordId = '', submittedAttachments }) {
  const payload = decodeReservation(token)
  if (!userId || payload.user_id !== userId) {
    throw Object.assign(new Error('This contract upload reservation belongs to another user.'), { statusCode: 403 })
  }
  if (payload.record_id && payload.record_id !== clean(recordId)) {
    throw Object.assign(new Error('These contract uploads belong to another client.'), { statusCode: 403 })
  }
  if (clean(recordId) && !payload.record_id) {
    throw Object.assign(new Error('A create reservation cannot be attached to an existing client.'), { statusCode: 403 })
  }
  const submitted = normalizeAttachments(submittedAttachments, { bucket: STORAGE_BUCKETS.CONTRACT })
  const reserved = normalizeAttachments(payload.files, { bucket: STORAGE_BUCKETS.CONTRACT })
  if (submitted.length !== reserved.length || submitted.some((item, index) => item.path !== reserved[index]?.path)) {
    throw Object.assign(new Error('Contract attachment metadata does not match the upload reservation.'), { statusCode: 400 })
  }
  return reserved
}

async function assertReservedUploadsExist(attachments) {
  const byFolder = new Map()
  for (const attachment of attachments || []) {
    const slash = attachment.path.lastIndexOf('/')
    const folder = slash === -1 ? '' : attachment.path.slice(0, slash)
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder).push(attachment)
  }
  for (const [folder, expected] of byFolder) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKETS.CONTRACT).list(folder, { limit: 100 })
    if (error) throw error
    const objects = new Map((data || []).map(item => [item.name, item]))
    for (const attachment of expected) {
      const name = attachment.path.slice(folder.length + (folder ? 1 : 0))
      const object = objects.get(name)
      if (!object) throw Object.assign(new Error(`${attachment.name}: Contract upload was not completed.`), { statusCode: 400 })
      const storedSize = Number(object.metadata?.size)
      if (Number.isFinite(storedSize) && attachment.size !== null && storedSize !== attachment.size) {
        throw Object.assign(new Error(`${attachment.name}: Uploaded file size does not match the selected file.`), { statusCode: 400 })
      }
    }
  }
}

function reservationAttachmentsForCleanup({ token, userId }) {
  const payload = decodeReservation(token)
  if (!userId || payload.user_id !== userId) {
    throw Object.assign(new Error('This contract upload reservation belongs to another user.'), { statusCode: 403 })
  }
  return normalizeAttachments(payload.files, { bucket: STORAGE_BUCKETS.CONTRACT })
}

module.exports = {
  MAX_CONTRACT_SIZE,
  assertReservedUploadsExist,
  createContractUploadReservation,
  reservationAttachmentsForCleanup,
  verifyContractUploadReservation
}
