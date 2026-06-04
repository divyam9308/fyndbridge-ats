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
  const match = String(text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

// Strong pattern: Indian mobile numbers start with 6-9 and may include +91.
function extractPhone(text) {
  const matches = String(text || '').match(/(\+91[\s\-]?)?[6-9]\d{9}/g)
  if (!matches || !matches.length) {
    return null
  }

  return matches[0].replace(/^\+91[\s\-]?/, '').replace(/\D/g, '').slice(-10)
}

// Heuristic: resumes usually put the person's name in the first few content lines.
function extractName(text) {
  const blockedHeaders = new Set(['RESUME', 'CURRICULUM VITAE', 'CV'])
  const candidates = normalizeLines(text)
    .slice(0, 5)
    .filter((line) => !blockedHeaders.has(line.toUpperCase()))
    .filter((line) => !line.includes('@') && !/\d/.test(line))
    .filter((line) => line.length >= 2 && line.length <= 80)
    .slice(0, 2)

  return candidates
}

// Strong-ish proximity pattern: years near experience/exp/total usually indicate total experience.
function extractExperience(text) {
  const value = String(text || '')
  const patterns = [
    /(experience|exp|total)[^\n]{0,40}?(\d+\.?\d*)\s*(years?|yrs?)/i,
    /(\d+\.?\d*)\s*(years?|yrs?)[^\n]{0,40}?(experience|exp|total)/i
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) {
      const numeric = Number.parseFloat(match[2] || match[1])
      return Number.isFinite(numeric) ? numeric : null
    }
  }

  return null
}

// Heuristic: designation is commonly labeled with title/designation/role keywords.
function extractCurrentDesignation(text) {
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
    return headings.some((heading) => normalized === heading || normalized.includes(heading))
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
  if (!source) {
    return []
  }

  return source
    .split(/[,|;\n]/)
    .map((skill) => skill.replace(/^[-*]\s*/, '').trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 40)
    .filter((skill, index, arr) => arr.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index)
    .slice(0, 20)
}

// Heuristic: education sections are usually compact, so return the first few following lines.
function extractEducation(text) {
  const lines = findSectionLines(text, ['education', 'qualification', 'academic'], 5)
  return lines.length ? lines.slice(0, 5).join(' ') : null
}

// Strong pattern over a bounded city dictionary used by this ATS geography filter.
function extractCity(text) {
  const cities = [
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
  return cities.find((city) => new RegExp(`\\b${city}\\b`, 'i').test(value)) || null
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
  const designation = extractCurrentDesignation(text)
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
    state: withConfidence(null, 'low'),
    current_designation: withConfidence(designation, 'low'),
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
  extractSkills,
  extractEducation,
  extractCity,
  extractSalary,
  extractFields
}
