const fs = require('fs/promises')
const pdfParse = require('pdf-parse')
const { createWorker } = require('tesseract.js')
const { extractFields } = require('./extractorUtils')
const { callAiJson, GEMINI_MODEL } = require('./aiProvider')

const RESUME_AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    mobile: { type: ['string', 'null'] },
    city: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    currentDesignation: { type: ['string', 'null'] },
    experience: { type: ['number', 'null'] },
    education: { type: ['string', 'null'] },
    skills: {
      type: ['array', 'null'],
      items: { type: 'string' }
    },
    salary: { type: ['number', 'null'] },
    linkedin: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] }
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeEmail(value) {
  const email = cleanText(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function normalizeMobile(value) {
  const input = cleanText(value)
  if (!input) {
    return null
  }

  const digits = input.replace(/[^\d+]/g, '')
  if (!digits) {
    return null
  }

  if (digits.startsWith('91') && digits.length === 12) {
    return digits.slice(-10)
  }

  return digits.startsWith('+') ? digits : digits
}

function normalizeSalary(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null
}

function isAcademicEducationEntry(entry) {
  const value = cleanText([
    entry?.institution,
    entry?.degree,
    entry?.years
  ].filter(Boolean).join(' ')).toLowerCase()

  if (!value) {
    return false
  }

  if (/\b(certificate|certification|certified|program(?:me)?|workshop|bootcamp|training|course|seminar|webinar)\b/i.test(value)) {
    return false
  }

  return /\b(bachelor|master|mba|b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?a|m\.?a|llb|llm|diploma|ph\.?d|doctorate|degree|college|university|school|institute|polytechnic)\b/i.test(value)
}

function formatEducationEntries(entries) {
  if (!Array.isArray(entries)) {
    return null
  }

  const lines = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }

      if (!isAcademicEducationEntry(entry)) {
        return null
      }

      const institution = cleanText(entry.institution)
      const degree = cleanText(entry.degree)
      const years = cleanText(entry.years)

      return [institution, degree, years].filter(Boolean).join(' - ')
    })
    .filter(Boolean)

  return lines.length ? lines.join('\n') : null
}

function normalizeResumeAiOutput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }

  const skills = Array.isArray(data.skills)
    ? [...new Set(
        data.skills
          .map((skill) => cleanText(skill))
          .filter(Boolean)
      )].slice(0, 20)
    : []

  return {
    name: cleanText(data.name) || null,
    email: normalizeEmail(data.email),
    mobile: normalizeMobile(data.mobile),
    city: cleanText(data.city) || null,
    state: cleanText(data.state) || null,
    location: null,
    currentDesignation: cleanText(data.currentDesignation) || null,
    currentOrganisation: null,
    experience: Number.isFinite(Number(data.experience)) ? Number(data.experience) : null,
    education: formatEducationEntries(data.education) || cleanText(data.education) || null,
    skills,
    salary: normalizeSalary(data.salary),
    linkedin: cleanText(data.linkedin) || null,
    summary: cleanText(data.summary) || null
  }
}

async function parseResumeWithAi(rawText) {
  const prompt = [
    'Extract the following resume fields from the cleaned resume text below and return JSON only.',
    'Do not invent values. Use null for missing fields.',
    'Fields: name, email, mobile, city, state, currentDesignation, experience, education, skills, salary, linkedin, summary.',
    'Mobile extraction is mandatory if a phone/mobile/contact number is present. Experience should be a number of years.',
    'Do not include certifications, certificate programs, workshops, short courses, seminars, bootcamps, training programs, or professional development programs in education.',
    'Resume text:',
    cleanText(rawText).slice(0, 12000)
  ].join('\n\n')

  const parsed = await callAiJson({
    prompt,
    schema: RESUME_AI_SCHEMA,
    temperature: 0.1,
    schemaName: 'resume_fields'
  })

  return normalizeResumeAiOutput(parsed)
}

async function extractTextWithOcr(fileBuffer) {
  const worker = await createWorker('eng')

  try {
    const result = await worker.recognize(fileBuffer)
    return result.data.text || ''
  } finally {
    await worker.terminate()
  }
}

async function parseResume(filePath) {
  const fileBuffer = await fs.readFile(filePath)

  const parsed = await pdfParse(fileBuffer)
  let rawText = parsed.text || ''

  if (rawText.trim().length < 100) {
    rawText = await extractTextWithOcr(fileBuffer)
  }

  const extracted = extractFields(rawText)
  let aiExtracted = null
  try {
    aiExtracted = await parseResumeWithAi(rawText)
    if (aiExtracted) {
      aiExtracted.location = aiExtracted.location || extracted.location?.value || null
      aiExtracted.currentOrganisation = aiExtracted.currentOrganisation || extracted.current_organisation?.value || null
      aiExtracted.name = aiExtracted.name || extracted.full_name?.value || null
      aiExtracted.email = aiExtracted.email || extracted.email?.value || null
      aiExtracted.mobile = aiExtracted.mobile || extracted.mobile_number?.value || null
      aiExtracted.city = aiExtracted.city || extracted.city?.value || null
      aiExtracted.state = aiExtracted.state || extracted.state?.value || null
      aiExtracted.currentDesignation = aiExtracted.currentDesignation || extracted.current_designation?.value || null
      aiExtracted.experience = aiExtracted.experience ?? extracted.experience_years?.value ?? null
      aiExtracted.education = aiExtracted.education || extracted.education?.value || null
      aiExtracted.skills = aiExtracted.skills.length ? aiExtracted.skills : extracted.skills?.value || []
    }
  } catch (err) {
    if (err.code === 'AI_QUOTA_REACHED') throw err
    console.warn(`parseResume AI fallback (${GEMINI_MODEL}):`, err.message)
  }

  return {
    extracted,
    ai_extracted: aiExtracted,
    raw_text: rawText
  }
}

module.exports = {
  parseResume
}
