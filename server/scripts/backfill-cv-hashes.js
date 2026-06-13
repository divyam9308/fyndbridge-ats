require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const crypto = require('crypto')
const supabase = require('../src/services/supabaseAdmin')

const hashBuffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

async function main() {
  const { data, error } = await supabase
    .from('candidates')
    .select('id, cv_link, resume_url, cv_file_hash')
    .is('cv_file_hash', null)
    .limit(10000)
  if (error) throw error

  let updated = 0
  for (const candidate of data || []) {
    const url = candidate.resume_url || candidate.cv_link
    if (!url || !/^https?:\/\//i.test(url)) continue
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      const cv_file_hash = hashBuffer(buffer)
      const { error: updateError } = await supabase
        .from('candidates')
        .update({ cv_file_hash })
        .eq('id', candidate.id)
      if (updateError) throw updateError
      updated += 1
    } catch (err) {
      console.error(`Skipped ${candidate.id}: ${err.message}`)
    }
  }
  console.log(`Updated ${updated} candidate CV hashes.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
