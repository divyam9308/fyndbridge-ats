const STORAGE_BUCKETS = {
  CV: 'resumes',
  JD: 'jds',
  CONTRACT: 'contract-pdfs'
}

const STORAGE_BUCKET_TYPES = {
  cv: STORAGE_BUCKETS.CV,
  resume: STORAGE_BUCKETS.CV,
  jd: STORAGE_BUCKETS.JD,
  contract: STORAGE_BUCKETS.CONTRACT,
  'contract-pdf': STORAGE_BUCKETS.CONTRACT
}

const LEGACY_BUCKET_NAMES = [
  STORAGE_BUCKETS.CV,
  STORAGE_BUCKETS.JD,
  STORAGE_BUCKETS.CONTRACT,
  'resume',
  'cvs',
  'cv',
  'candidate-cvs',
  'candidate_cvs',
  'job-documents',
  'client-contracts'
]

function cleanText(value) {
  return String(value || '').trim()
}

function normalizeStoragePath(value, bucketName = '') {
  const text = cleanText(value)
  if (!text) return ''
  let objectPath = text
  if (text.startsWith('/api/documents/open')) {
    try {
      const parsed = new URL(text, 'http://local')
      objectPath = parsed.searchParams.get('path') || ''
    } catch {
      objectPath = text
    }
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      if (parsed.pathname.startsWith('/api/documents/open')) {
        objectPath = parsed.searchParams.get('path') || ''
      } else {
        const marker = '/storage/v1/object/'
        const index = parsed.pathname.indexOf(marker)
        if (index === -1) return text
        objectPath = decodeURIComponent(parsed.pathname.slice(index + marker.length))
      }
    } catch {
      return text
    }
  }
  objectPath = objectPath.replace(/^public\//, '').replace(/^sign\//, '')
  const buckets = [...new Set([bucketName, ...LEGACY_BUCKET_NAMES].filter(Boolean))]
  let changed = true
  while (changed) {
    changed = false
    for (const bucket of buckets) {
      if (objectPath.startsWith(`${bucket}/`)) {
        objectPath = objectPath.slice(bucket.length + 1)
        changed = true
      }
    }
  }
  return objectPath
}

function bucketForType(type) {
  return STORAGE_BUCKET_TYPES[cleanText(type).toLowerCase()] || ''
}

function documentOpenUrl(type, pathOrUrl) {
  const value = cleanText(pathOrUrl)
  if (!value) return ''
  const bucket = bucketForType(type)
  const cleanPath = normalizeStoragePath(value, bucket)
  if (/^https?:\/\//i.test(value) && cleanPath === value) return value
  if (!bucket || !cleanPath) return ''
  const params = new URLSearchParams({ path: cleanPath })
  return `/api/documents/open/${encodeURIComponent(type)}?${params.toString()}`
}

module.exports = {
  STORAGE_BUCKETS,
  bucketForType,
  documentOpenUrl,
  normalizeStoragePath
}
