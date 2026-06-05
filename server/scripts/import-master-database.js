require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const normalizeMobile = (value) => clean(value).replace(/[^\d+]/g, '')

function numberFromText(value) {
  const text = clean(value).replace(/,/g, '')
  if (!text || /^[-–—]+$/.test(text)) return null
  const match = text.match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function parseCtc(value) {
  const text = clean(value).toLowerCase()
  const num = numberFromText(text)
  if (num === null) return null
  if (/cr|crore/.test(text)) return Math.round(num * 10000000)
  if (/l|lac|lakh|lakhs/.test(text) || num <= 300) return Math.round(num * 100000)
  return Math.round(num)
}

function normalizeStatus(value) {
  const status = clean(value)
  const lower = status.toLowerCase()
  const map = {
    interested: 'Interested',
    'not interested': 'Not Interested',
    interview: 'Interview',
    'client submission': 'Client Submission',
    offered: 'Offered',
    hired: 'Hired',
    'rejected by recruiter': 'Rejected by Recruiter',
    'rejected by client': 'Rejected by Client',
    'in discussion': 'Interested',
    'may be': 'Interested'
  }
  return map[lower] || status || 'Interested'
}

function parseDate(value) {
  const text = clean(value)
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!match) return new Date().toISOString()
  const day = match[1].padStart(2, '0')
  const month = match[2].padStart(2, '0')
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function chunk(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function insertBatch(table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).insert(batch)
    if (error) throw error
  }
}

async function fetchAllCandidatesBySource(source) {
  const rows = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, full_name, mobile_number')
      .eq('source', source)
      .range(from, from + pageSize - 1)

    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  return rows
}

async function main() {
  const csvPath = path.join(__dirname, '..', '..', 'data', 'master-database.csv')
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')).filter((row) => row.some(clean))
  const headerIndex = rows.findIndex((row) => clean(row[0]).toLowerCase() === 's.no')
  if (headerIndex === -1) throw new Error('CSV header row not found')

  const headers = rows[headerIndex].map(clean)
  const records = rows.slice(headerIndex + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, clean(row[index])])))
    .filter((row) => row['Candidate name'] && row.Mobile)

  const candidateByKey = new Map()
  const associations = []

  for (const row of records) {
    const fullName = row['Candidate name']
    const mobile = normalizeMobile(row.Mobile)
    const key = `${fullName.toLowerCase()}|${mobile}`
    const candidate = candidateByKey.get(key) || {
      full_name: fullName,
      email: row['Email ID'] || null,
      mobile_number: mobile,
      city: row['Current Location'] || null,
      state: null,
      location: row['Current Location'] || null,
      current_designation: row.Designation || null,
      current_company: row.Organisation || null,
      current_organisation: row.Organisation || null,
      experience_years: numberFromText(row.Experience),
      notice_period: numberFromText(row['Notice Period']),
      open_to_relocate: /^yes$/i.test(row['Open to relocate']),
      skills: [],
      education: null,
      cv_link: row['CV Link'] || null,
      linkedin_url: row.Linkedin || row['Linkedin '] || null,
      source: 'master_csv',
      created_at: parseDate(row.Date),
      updated_at: new Date().toISOString()
    }

    candidateByKey.set(key, candidate)
    associations.push({
      key,
      row,
      payload: {
        consultant_name: row.Consultant || null,
        client_name: row['Client Name'] || null,
        job_title: row.Role || null,
        status: normalizeStatus(row.Status),
        current_salary: parseCtc(row['Current CTC']),
        expected_salary: parseCtc(row['Expected CTC']),
        notes: row.Comments || null,
        created_at: parseDate(row.Date),
        updated_at: new Date().toISOString()
      }
    })
  }

  await supabase.from('candidate_associations').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('candidates').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const candidates = [...candidateByKey.values()]
  await insertBatch('candidates', candidates)

  const inserted = await fetchAllCandidatesBySource('master_csv')

  const idByKey = new Map(inserted.map((candidate) => [
    `${candidate.full_name.toLowerCase()}|${candidate.mobile_number}`,
    candidate.id
  ]))

  await insertBatch('candidate_associations', associations.map(({ key, payload }) => ({
    ...payload,
    candidate_id: idByKey.get(key)
  })).filter((row) => row.candidate_id))

  console.log(`Imported ${candidates.length} candidates and ${associations.length} associations`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
