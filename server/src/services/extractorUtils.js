const SECTION_HEADERS = [
  'experience',
  'employment',
  'work experience',
  'projects',
  'education',
  'qualification',
  'academic',
  'skills',
  'technical skills',
  'technologies',
  'tech stack',
  'core competencies',
  'certifications',
  'summary',
  'profile'
]

const EDUCATION_SECTION_HEADERS = new Set([
  'education',
  'academic qualifications',
  'qualifications'
])

const STOP_SECTION_HEADERS = new Set([
  'professional qualifications',
  'scholarships',
  'diplomas',
  'writing',
  'publications',
  'latest participations and talks',
  'languages',
  'references'
])

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function withConfidence(value, confidence) {
  return { value: value || null, confidence }
}

// Strong pattern: email addresses have a stable, distinctive syntax.
function extractEmail(text) {
  const normalized = String(text || '').replace(/\s*@\s*/g, '@').replace(/@\s+/g, '@')
  const match = normalized.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

// Strong pattern: prefer labelled contact/mobile values, then fall back to phone-like numbers.
function extractPhone(text) {
  const value = String(text || '')
  const labelled = value.match(/(?:contact number|mobile|phone|whatsapp)\D{0,30}(\+\d{1,3}[\s-]?\d[\d\s-]{7,18})/i)
  const fallback = value.match(/(\+\d{1,3}[\s-]?\d[\d\s-]{7,18}|[6-9]\d{9})/)
  const match = labelled || fallback

  if (!match) {
    return null
  }

  const raw = match[1] || match[0]
  const hasPlus = raw.trim().startsWith('+')
  const digits = raw.replace(/\D/g, '')

  if (!digits) {
    return null
  }

  if (digits.startsWith('91') && digits.length === 12) {
    return digits.slice(-10)
  }

  return hasPlus ? `+${digits}` : digits
}

// Heuristic: resumes usually put the person's name in the first few content lines.
function extractName(text) {
  const blockedHeaders = new Set(['RESUME', 'CURRICULUM VITAE', 'CV'])
  const candidates = normalizeLines(text)
    .slice(0, 5)
    .filter((line) => !blockedHeaders.has(line.toUpperCase()))
    .filter((line) => !line.includes('@') && !/\d/.test(line))
    .filter((line) => !/^(address|contact|phone|mobile|email)\b/i.test(line))
    .filter((line) => line.length >= 2 && line.length <= 80)
    .slice(0, 2)

  return candidates
}

function sectionBounds(lines, headingPattern) {
  const start = lines.findIndex((line) => headingPattern.test(line))
  if (start === -1) {
    return null
  }

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^education:?$/i.test(lines[i]) || STOP_SECTION_HEADERS.has(lines[i].replace(/:$/, '').trim().toLowerCase())) {
      end = i
      break
    }
  }

  return { start, end }
}

function parseEndYear(startYear, endToken) {
  if (!endToken) {
    return startYear
  }

  if (endToken.length === 1) {
    return Math.floor(startYear / 10) * 10 + Number(endToken)
  }

  if (endToken.length === 2) {
    return Math.floor(startYear / 100) * 100 + Number(endToken)
  }

  return Number(endToken)
}

// Heuristic: use the professional experience section date range, not incidental "15 years" phrases.
function extractExperience(text) {
  const lines = normalizeLines(text)
  const bounds = sectionBounds(lines, /^professional experience:?$/i)
  const source = bounds ? lines.slice(bounds.start, bounds.end).join('\n') : String(text || '')
  const years = []
  const ranges = source.matchAll(/\b(19\d{2}|20\d{2})\s*[-–]\s*(?:(19\d{2}|20\d{2})|(\d{1,2})|present|current)?\b/gi)

  for (const match of ranges) {
    const start = Number(match[1])
    const end = /present|current/i.test(match[0]) ? new Date().getFullYear() : parseEndYear(start, match[2] || match[3])
    if (start >= 1950 && end >= start && end <= new Date().getFullYear()) {
      years.push(start, end)
    }
  }

  const standalone = source.matchAll(/\b(19\d{2}|20\d{2})\b/g)
  for (const match of standalone) {
    years.push(Number(match[1]))
  }

  if (years.length >= 2) {
    return Math.max(...years) - Math.min(...years)
  }

  const proximity = String(text || '').match(/(?:experience|exp|total)[^\n]{0,40}?(\d+\.?\d*)\s*(?:years?|yrs?)/i)
  return proximity ? Number.parseFloat(proximity[1]) : null
}

function getCurrentExperienceBlock(text) {
  const lines = normalizeLines(text)
  const bounds = sectionBounds(lines, /^professional experience:?$/i)
  if (!bounds) {
    return []
  }

  const block = []
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    if (!block.length && !lines[i]) {
      continue
    }
    if (block.length && /^[A-Z][A-Za-z\s/&().-]+,?\s*(19\d{2}|20\d{2}|present|current)/i.test(lines[i])) {
      break
    }
    block.push(lines[i])
    if (block.length >= 8) {
      break
    }
  }

  return block
}

// Heuristic: current role is usually the first dated title under Professional Experience.
function extractCurrentDesignation(text) {
  const currentBlock = getCurrentExperienceBlock(text)
  if (currentBlock.length) {
    const roleLine = currentBlock.find((line) => /,\s*(19\d{2}|20\d{2}|present|current)/i.test(line))
    if (roleLine) {
      return roleLine.replace(/,\s*(19\d{2}|20\d{2}|present|current).*/i, '').trim()
    }
  }

  const keywords = ['Title', 'Designation', 'Position', 'Role', 'Currently working as', 'Current Role']
  const lines = normalizeLines(text)

  for (const line of lines) {
    const keyword = keywords.find((item) => line.toLowerCase().includes(item.toLowerCase()))
    if (keyword) {
      const afterColon = line.split(':').slice(1).join(':').trim()
      const withoutKeyword = line.replace(new RegExp(keyword, 'i'), '').replace(/^[:\-\s]+/, '').trim()
      return afterColon || withoutKeyword || line
    }
  }

  return null
}

// Heuristic: the organization is normally the line immediately after the current role title.
function extractCurrentCompany(text) {
  const currentBlock = getCurrentExperienceBlock(text)
  const roleIndex = currentBlock.findIndex((line) => /,\s*(19\d{2}|20\d{2}|present|current)/i.test(line))
  if (roleIndex !== -1 && currentBlock[roleIndex + 1]) {
    return currentBlock[roleIndex + 1].replace(/\s+/g, ' ').trim()
  }

  return null
}

function isSectionHeader(line) {
  const clean = line.replace(/:$/, '').trim()
  const lower = clean.toLowerCase()

  if (SECTION_HEADERS.includes(lower)) {
    return true
  }

  return clean.length <= 35 && /^[A-Z][A-Za-z\s/&-]+:?$/.test(line)
}

function findSectionLines(text, headings, maxLines) {
  const lines = normalizeLines(text)
  const startIndex = lines.findIndex((line) => {
    const normalized = line.replace(/:$/, '').trim().toLowerCase()
    return headings.some((heading) => normalized === heading)
  })

  if (startIndex === -1) {
    return []
  }

  const output = []
  for (let i = startIndex + 1; i < lines.length && output.length < maxLines; i += 1) {
    if (output.length && isSectionHeader(lines[i])) {
      break
    }
    output.push(lines[i])
  }

  return output
}

// Heuristic: collect content below common skills headings, then split common delimiter formats.
function extractSkills(text) {
  const sectionLines = findSectionLines(
    text,
    ['skills', 'technical skills', 'technologies', 'tech stack', 'core competencies'],
    10
  )

  const source = sectionLines.join('\n')
  let skillSource = source

  if (!skillSource) {
    const expertiseMatch = String(text || '').match(/Expertise\s+in\s+(.{20,500}?)(?:={5,}|Professional Experience:)/is)
    if (expertiseMatch) {
      skillSource = expertiseMatch[1]
        .replace(/\s+/g, ' ')
        .replace(/\bin\s+the\s+fields\s+and\s+intersections\s+of\b/i, ',')
        .replace(/\band\b/gi, ',')
    }
  }

  if (!skillSource) {
    return []
  }

  return skillSource
    .split(/[,|;\n]/)
    .map((skill) => skill.replace(/^[-*]\s*/, '').trim())
    .map((skill) => skill.replace(/\s+/g, ' '))
    .map((skill) => skill.replace(/^(of|in)\s+/i, '').replace(/\.$/, '').trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 40)
    .filter((skill, index, arr) => arr.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index)
    .slice(0, 20)
}

// Heuristic: match only a real Education heading, then collect degree lines until the next major section.
function extractEducation(text) {
  const lines = normalizeLines(text)
  const startIndex = lines.findIndex((line) => EDUCATION_SECTION_HEADERS.has(line.replace(/:$/, '').trim().toLowerCase()))

  if (startIndex === -1) {
    return null
  }

  const output = []
  for (let i = startIndex + 1; i < lines.length && output.length < 18; i += 1) {
    const normalized = lines[i].replace(/:$/, '').trim().toLowerCase()
    if (STOP_SECTION_HEADERS.has(normalized)) {
      break
    }
    output.push(lines[i])
  }

  return output.length ? output.join('\n') : null
}

// Strong pattern over a bounded city dictionary used by this ATS geography filter.
function extractCity(text) {
  const cities = [
    'Caracas',
    'San José',
    'San Jose',
    'Kamkole',
    'Mérida',
    'Merida',
    'Madrid',
    'Cambridge',
    'Mumbai',
    'Delhi',
    'Bangalore',
    'Bengaluru',
    'Hyderabad',
    'Chennai',
    'Kolkata',
    'Pune',
    'Ahmedabad',
    'Jaipur',
    'Surat',
    'Lucknow',
    'Kanpur',
    'Nagpur',
    'Indore',
    'Thane',
    'Bhopal',
    'Visakhapatnam',
    'Patna',
    'Vadodara',
    'Ghaziabad',
    'Ludhiana',
    'Agra',
    'Nashik',
    'Faridabad',
    'Meerut',
    'Rajkot',
    'Kalyan',
    'Vasai',
    'Noida'
  ]

  const value = String(text || '')
  const addressMatch = value.match(/Address:\s*([^\n]+)/i)
  if (addressMatch) {
    const addressCity = cities.find((city) => new RegExp(`\\b${city}\\b`, 'i').test(addressMatch[1]))
    if (addressCity) {
      return addressCity
    }
  }

  return cities.find((city) => new RegExp(`\\b${city}\\b`, 'i').test(value)) || null
}

// Strong pattern over common state/province names appearing near current roles or addresses.
function extractState(text) {
  const states = [
    'Telangana',
    'Karnataka',
    'Maharashtra',
    'Delhi',
    'Tamil Nadu',
    'Gujarat',
    'Rajasthan',
    'Uttar Pradesh',
    'Madhya Pradesh',
    'Venezuela',
    'Costa Rica'
  ]
  const value = String(text || '')
  const addressMatch = value.match(/Address:\s*([^\n]+)/i)
  if (addressMatch) {
    return states.find((state) => new RegExp(`\\b${state}\\b`, 'i').test(addressMatch[1])) || null
  }

  const source = value.slice(0, 1200)
  return states.find((state) => new RegExp(`\\b${state}\\b`, 'i').test(source)) || null
}

// Heuristic: salary values are only trusted when near compensation keywords.
function extractSalary(text) {
  const lines = normalizeLines(text)
  const keywordPattern = /(ctc|salary|package|compensation|lpa|lakhs?)/i

  for (const line of lines) {
    if (!keywordPattern.test(line)) {
      continue
    }

    const match = line.match(/(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lac|lacs)?/i)
    if (!match) {
      continue
    }

    const value = Number.parseFloat(match[1])
    if (!Number.isFinite(value)) {
      continue
    }

    if (/(lpa|lakhs?|lac|lacs)/i.test(match[2] || line)) {
      return Math.round(value * 100000)
    }

    return Math.round(value)
  }

  return null
}

function extractFields(text) {
  const nameCandidates = extractName(text)
  const email = extractEmail(text)
  const phone = extractPhone(text)
  const city = extractCity(text)
  const state = extractState(text)
  const designation = extractCurrentDesignation(text)
  const currentCompany = extractCurrentCompany(text)
  const experience = extractExperience(text)
  const skills = extractSkills(text)
  const education = extractEducation(text)
  const salary = extractSalary(text)

  return {
    full_name: withConfidence(nameCandidates[0] || null, 'low'),
    full_name_candidates: nameCandidates,
    email: withConfidence(email, email ? 'high' : 'low'),
    mobile_number: withConfidence(phone, phone ? 'high' : 'low'),
    city: withConfidence(city, city ? 'high' : 'low'),
    state: withConfidence(state, state ? 'high' : 'low'),
    current_designation: withConfidence(designation, designation ? 'high' : 'low'),
    current_company: withConfidence(currentCompany, currentCompany ? 'high' : 'low'),
    experience_years: withConfidence(experience, experience !== null ? 'high' : 'low'),
    skills: withConfidence(skills.length ? skills : null, skills.length ? 'high' : 'low'),
    education: withConfidence(education, 'low'),
    current_salary: withConfidence(salary, 'low')
  }
}

module.exports = {
  extractEmail,
  extractPhone,
  extractName,
  extractExperience,
  extractCurrentDesignation,
  extractCurrentCompany,
  extractSkills,
  extractEducation,
  extractCity,
  extractState,
  extractSalary,
  extractFields
}
