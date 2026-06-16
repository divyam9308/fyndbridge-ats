const supabase = require('../src/services/supabaseAdmin')
const { RESUME_BUCKET, normalizeResumeStoragePath } = require('../src/services/cvStorage')

function clean(value) {
  return String(value || '').trim()
}

function isStorageUrl(value) {
  return /\/storage\/v1\/object\//i.test(clean(value))
}

function isExternalUrl(value) {
  return /^https?:\/\//i.test(clean(value)) && !isStorageUrl(value)
}

async function main() {
  const { data, error } = await supabase
    .from('candidates')
    .select('id, cv_link, resume_url, cv_storage_path')
    .limit(10000)

  if (error) throw error

  let changed = 0
  for (const row of data || []) {
    const currentPath = clean(row.cv_storage_path)
    const cvLink = clean(row.cv_link)
    const resumeUrl = clean(row.resume_url)
    const source = currentPath || cvLink || resumeUrl
    const nextPath = isExternalUrl(source) ? currentPath : normalizeResumeStoragePath(source)
    const patch = {}

    if (nextPath && nextPath !== currentPath) patch.cv_storage_path = nextPath
    if (cvLink && !isExternalUrl(cvLink) && normalizeResumeStoragePath(cvLink) === nextPath) patch.cv_link = ''
    if (resumeUrl && !isExternalUrl(resumeUrl) && normalizeResumeStoragePath(resumeUrl) === nextPath) patch.resume_url = ''

    if (!Object.keys(patch).length) continue
    const { error: updateError } = await supabase.from('candidates').update(patch).eq('id', row.id)
    if (updateError) throw updateError
    changed += 1
    console.log('repaired CV path', { id: row.id, bucket: RESUME_BUCKET, path: nextPath })
  }

  console.log(`CV path repair complete. Updated ${changed} rows.`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
