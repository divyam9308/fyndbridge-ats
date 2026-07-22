const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const { normalizeMandateStatus } = require('./mandateStatuses')
const { STORAGE_BUCKETS, normalizeStoragePath } = require('./storageBuckets')

const PUBLIC_APPLICATION_BUCKET = STORAGE_BUCKETS.PUBLIC_APPLICATIONS
const PUBLIC_JOB_FIELDS = Object.freeze([
  'is_public',
  'public_slug',
  'public_name',
  'public_location',
  'public_experience',
  'public_skills',
  'application_deadline',
  'public_jd'
])
const ACTIVE_APPLICATION_STATUSES = Object.freeze(['pending', 'converting'])

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function cleanMultiline(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

function parseStringArray(value) {
  let incoming = value
  if (typeof incoming === 'string' && incoming.trim().startsWith('[')) {
    try { incoming = JSON.parse(incoming) } catch { incoming = value }
  }
  const values = Array.isArray(incoming) ? incoming : String(incoming || '').split(',')
  return [...new Set(values.map(clean).filter(Boolean))]
}

function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function isDateOnly(value) {
  const text = clean(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

function hasCompletePublicListing(job) {
  return Boolean(
    clean(job?.public_slug) &&
    clean(job?.public_name) &&
    clean(job?.public_location) &&
    clean(job?.public_experience) &&
    isDateOnly(job?.application_deadline) &&
    cleanMultiline(job?.public_jd)
  )
}

function publicJobState(job, now = new Date()) {
  if (!job?.is_public) return 'Not Public'
  if (!hasCompletePublicListing(job)) return 'Incomplete'
  if (normalizeMandateStatus(job.mandate_status) !== 'Ongoing (P1)') return 'Closed'
  if (clean(job.application_deadline) < indiaDate(now)) return 'Expired'
  return 'Published'
}

function isPublicJobEligible(job, now = new Date()) {
  return publicJobState(job, now) === 'Published'
}

function publicRoleDto(job, { detail = false } = {}) {
  const dto = {
    slug: clean(job.public_slug),
    public_name: clean(job.public_name),
    public_location: clean(job.public_location),
    public_experience: clean(job.public_experience),
    public_skills: parseStringArray(job.public_skills),
    application_deadline: clean(job.application_deadline)
  }
  if (detail) dto.public_jd = cleanMultiline(job.public_jd)
  return dto
}

function slugBase(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'role'
}

function buildPublicSlug(publicName, displayId, suffix = '') {
  const idPart = clean(displayId).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'role'
  return `${slugBase(publicName)}-${idPart}${suffix ? `-${suffix}` : ''}`.slice(0, 120)
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  const text = clean(value).toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off', ''].includes(text)) return false
  throw Object.assign(new Error('is_public must be true or false'), { statusCode: 400 })
}

function publicJobPayload(body, partial = false) {
  const payload = {}
  const has = (field) => Object.prototype.hasOwnProperty.call(body || {}, field)
  if (!partial || has('is_public')) payload.is_public = has('is_public') ? normalizeBoolean(body.is_public) : false
  for (const field of ['public_name', 'public_location', 'public_experience']) {
    if (!partial || has(field)) payload[field] = clean(body[field]) || null
  }
  if (!partial || has('public_skills')) payload.public_skills = parseStringArray(body.public_skills)
  if (!partial || has('application_deadline')) payload.application_deadline = clean(body.application_deadline) || null
  if (!partial || has('public_jd')) payload.public_jd = cleanMultiline(body.public_jd) || null
  return payload
}

function publicJobDetailsChanged(current, next) {
  const textFields = ['public_name', 'public_location', 'public_experience', 'application_deadline']
  if (textFields.some((field) => clean(current?.[field]) !== clean(next?.[field]))) return true
  if (cleanMultiline(current?.public_jd) !== cleanMultiline(next?.public_jd)) return true
  const currentSkills = parseStringArray(current?.public_skills).slice().sort((left, right) => left.localeCompare(right))
  const nextSkills = parseStringArray(next?.public_skills).slice().sort((left, right) => left.localeCompare(right))
  return JSON.stringify(currentSkills) !== JSON.stringify(nextSkills)
}

function validatePublicJobForPublish(job, now = new Date()) {
  if (!job.is_public) return
  const errors = {}
  if (!clean(job.public_name)) errors.public_name = 'Public role name is required'
  if (!clean(job.public_location)) errors.public_location = 'Public location is required'
  if (!clean(job.public_experience)) errors.public_experience = 'Public experience is required'
  if (!isDateOnly(job.application_deadline)) errors.application_deadline = 'Application deadline is required'
  else if (clean(job.application_deadline) < indiaDate(now)) errors.application_deadline = 'Application deadline cannot be in the past'
  if (!cleanMultiline(job.public_jd)) errors.public_jd = 'Public job description is required'
  if (normalizeMandateStatus(job.mandate_status) !== 'Ongoing (P1)') {
    errors.is_public = 'Only Ongoing (P1) mandates can be published'
  }
  if (Object.keys(errors).length) throw Object.assign(new Error('Complete the Public Careers Listing before publishing.'), { statusCode: 400, errors })
}

async function allocatePublicSlug(supabase, publicName, displayId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = buildPublicSlug(publicName, displayId, attempt || '')
    const { data, error } = await supabase.from('jobs').select('id').eq('public_slug', slug).limit(1).maybeSingle()
    if (error) throw error
    if (!data) return slug
  }
  return buildPublicSlug(publicName, displayId, crypto.randomBytes(3).toString('hex'))
}

async function listEligiblePublicJobs(supabase, now = new Date()) {
  const { data, error } = await supabase
    .from('jobs')
    .select('is_public, public_slug, public_name, public_location, public_experience, public_skills, application_deadline, public_jd, mandate_status')
    .eq('is_public', true)
    .eq('mandate_status', 'Ongoing (P1)')
    .gte('application_deadline', indiaDate(now))
    .order('application_deadline', { ascending: true })
  if (error) throw error
  return (data || []).filter((job) => isPublicJobEligible(job, now)).map((job) => publicRoleDto(job))
}

async function countEligiblePublicJobs(supabase, now = new Date()) {
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('is_public', true)
    .eq('mandate_status', 'Ongoing (P1)')
    .gte('application_deadline', indiaDate(now))
    .not('public_slug', 'is', null)
    .not('public_name', 'is', null)
    .not('public_location', 'is', null)
    .not('public_experience', 'is', null)
    .not('public_jd', 'is', null)
  if (error) throw error
  return count || 0
}

async function getPublicJobBySlug(supabase, slug, { internal = false, now = new Date() } = {}) {
  const normalizedSlug = clean(slug)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug) || normalizedSlug.length > 120) return null
  const columns = internal
    ? 'id, client_id, title, consultants, is_public, public_slug, public_name, public_location, public_experience, public_skills, application_deadline, public_jd, mandate_status, clients(name, client_name)'
    : 'is_public, public_slug, public_name, public_location, public_experience, public_skills, application_deadline, public_jd, mandate_status'
  const { data, error } = await supabase
    .from('jobs')
    .select(columns)
    .eq('public_slug', normalizedSlug)
    .eq('is_public', true)
    .eq('mandate_status', 'Ongoing (P1)')
    .gte('application_deadline', indiaDate(now))
    .maybeSingle()
  if (error) throw error
  return data && isPublicJobEligible(data, now) ? data : null
}

function normalizeEmail(value) {
  return clean(value).toLowerCase()
}

function normalizeMobile(value) {
  const text = clean(value)
  const prefix = text.startsWith('+') ? '+' : ''
  return `${prefix}${text.replace(/\D/g, '')}`
}

function normalizedMobileIdentity(value) {
  return normalizeMobile(value).replace(/\D/g, '')
}

function safeInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : Number.NaN
}

function validatePublicApplication(body) {
  const errors = {}
  const requiredText = [
    'full_name', 'email', 'mobile_number', 'current_designation', 'current_organisation',
    'location', 'open_to_relocate'
  ]
  for (const field of requiredText) if (!clean(body[field])) errors[field] = `${field} is required`
  const email = normalizeEmail(body.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address'
  const mobile = normalizeMobile(body.mobile_number)
  if (mobile && !/^\+?\d{7,15}$/.test(mobile)) errors.mobile_number = 'Enter a valid mobile number'
  const experience = Number(body.experience_years)
  if (!clean(body.experience_years) || !Number.isFinite(experience) || experience < 0) errors.experience_years = 'Experience must be zero or greater'
  const notice = safeInteger(body.notice_period)
  if (!clean(body.notice_period) || !Number.isInteger(notice) || notice < 0) errors.notice_period = 'Notice period must be a whole number'
  const currentSalary = safeInteger(body.current_salary)
  if (!Number.isInteger(currentSalary) || currentSalary <= 0 || currentSalary > 999999999) {
    errors.current_salary = 'CTC must be a positive whole LPA value with at most 9 digits'
  }
  const skills = parseStringArray(body.skills)
  if (!skills.length) errors.skills = 'At least one skill is required'
  if (clean(body.linkedin_url)) {
    try {
      const url = new URL(clean(body.linkedin_url))
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid')
    } catch { errors.linkedin_url = 'Enter a valid LinkedIn URL' }
  }
  if (!['true', 'false', 'NA'].includes(clean(body.open_to_relocate))) errors.open_to_relocate = 'Select whether the candidate is open to relocate'
  if (!clean(body.role_slug)) errors.role_slug = 'Role is required'
  return errors
}

function publicApplicationPayload(body) {
  return {
    full_name: clean(body.full_name),
    email: normalizeEmail(body.email),
    email_normalized: normalizeEmail(body.email),
    mobile_number: normalizeMobile(body.mobile_number),
    mobile_normalized: normalizedMobileIdentity(body.mobile_number),
    current_designation: clean(body.current_designation),
    current_organisation: clean(body.current_organisation),
    experience_years: Number(body.experience_years),
    location: clean(body.location),
    skills: parseStringArray(body.skills),
    notice_period: Number(body.notice_period),
    current_salary: Number(body.current_salary),
    linkedin_url: clean(body.linkedin_url) || null,
    comments: cleanMultiline(body.comments) || null,
    open_to_relocate: clean(body.open_to_relocate)
  }
}

async function activeApplicationDuplicate(supabase, jobId, email, mobile) {
  const [emailResult, mobileResult] = await Promise.all([
    supabase.from('public_applications').select('id').eq('job_id', jobId).eq('email_normalized', email).in('application_status', ACTIVE_APPLICATION_STATUSES).limit(1).maybeSingle(),
    supabase.from('public_applications').select('id').eq('job_id', jobId).eq('mobile_normalized', mobile).in('application_status', ACTIVE_APPLICATION_STATUSES).limit(1).maybeSingle()
  ])
  if (emailResult.error) throw emailResult.error
  if (mobileResult.error) throw mobileResult.error
  return emailResult.data || mobileResult.data || null
}

function stagedResumePath(applicationId) {
  return `${applicationId}/resume.pdf`
}

function safeOriginalName(value) {
  return path.basename(String(value || 'resume.pdf')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'resume.pdf'
}

async function stagePublicApplication({ supabase, job, body, file }) {
  const values = publicApplicationPayload(body)
  if (await activeApplicationDuplicate(supabase, job.id, values.email_normalized, values.mobile_normalized)) {
    throw Object.assign(new Error('An active application already exists for this role.'), { statusCode: 409, publicSafe: true })
  }
  const applicationId = uuidv4()
  const objectPath = stagedResumePath(applicationId)
  const buffer = file.buffer || await fs.readFile(file.path)
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')
  const { error: uploadError } = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).upload(objectPath, buffer, {
    contentType: 'application/pdf',
    upsert: false
  })
  if (uploadError) throw Object.assign(new Error('Resume upload failed. Please try again.'), { statusCode: 502, publicSafe: true })

  const clientName = clean(job.clients?.client_name || job.clients?.name) || '-'
  const row = {
    id: applicationId,
    job_id: job.id,
    client_id: job.client_id,
    public_role_name: clean(job.public_name),
    internal_job_title_snapshot: clean(job.title) || '-',
    client_name_snapshot: clientName,
    mandate_consultants_snapshot: parseStringArray(job.consultants),
    ...values,
    cv_storage_path: objectPath,
    cv_original_name: safeOriginalName(file.originalname),
    cv_mimetype: 'application/pdf',
    cv_file_hash: fileHash,
    application_status: 'pending'
  }
  const { error: insertError } = await supabase.from('public_applications').insert(row)
  if (insertError) {
    let cleanupResult = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).remove([objectPath])
    if (cleanupResult.error) {
      cleanupResult = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).remove([objectPath])
      if (cleanupResult.error) {
        console.error('public application CV rollback failed:', cleanupResult.error.message)
      }
    }
    if (insertError.code === '23505') {
      throw Object.assign(new Error('An active application already exists for this role.'), { statusCode: 409, publicSafe: true })
    }
    throw insertError
  }
  return { applicationId }
}

function validateStagedResumePath(application) {
  const expected = stagedResumePath(application.id)
  const actual = normalizeStoragePath(application.cv_storage_path, PUBLIC_APPLICATION_BUCKET)
  if (actual !== expected) throw Object.assign(new Error('The staged resume path is invalid.'), { statusCode: 409 })
  return actual
}

async function adoptStagedResume(supabase, application) {
  const sourcePath = validateStagedResumePath(application)
  const destinationPath = `${application.cv_file_hash}.pdf`
  const target = supabase.storage.from(STORAGE_BUCKETS.CV)
  let created = false
  const { error } = await supabase.storage.from(PUBLIC_APPLICATION_BUCKET).copy(sourcePath, destinationPath, {
    destinationBucket: STORAGE_BUCKETS.CV
  })
  if (error && !/already exists|duplicate/i.test(error.message || '')) throw error
  created = !error
  const { data: publicData } = target.getPublicUrl(destinationPath)
  return {
    cv_link: publicData?.publicUrl || null,
    resume_url: publicData?.publicUrl || null,
    cv_file_hash: application.cv_file_hash,
    cv_storage_path: destinationPath,
    cv_original_name: application.cv_original_name,
    cv_mimetype: 'application/pdf',
    created
  }
}

async function removeAdoptedResumeIfUnreferenced(supabase, adopted) {
  if (!adopted?.created || !adopted.cv_storage_path) return
  const { count, error } = await supabase
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .eq('cv_storage_path', adopted.cv_storage_path)
  if (!error && !count) await supabase.storage.from(STORAGE_BUCKETS.CV).remove([adopted.cv_storage_path])
}

function parsedResumeDto(result) {
  const ai = result?.ai_extracted || {}
  const extracted = result?.extracted || {}
  const value = (field) => extracted[field]?.value ?? null
  const location = ai.location || [ai.city, ai.state].filter(Boolean).join(', ') || value('location') || value('city') || null
  return {
    full_name: ai.name || value('full_name') || null,
    email: ai.email || value('email') || null,
    mobile_number: ai.mobile || value('mobile_number') || null,
    current_designation: ai.currentDesignation || value('current_designation') || null,
    current_organisation: ai.currentOrganisation || value('current_organisation') || value('current_company') || null,
    experience_years: ai.experience ?? value('experience_years') ?? null,
    location,
    skills: parseStringArray(ai.skills?.length ? ai.skills : value('skills')),
    current_salary: ai.salary ?? value('current_salary') ?? null,
    linkedin_url: ai.linkedin || value('linkedin_url') || null
  }
}

module.exports = {
  PUBLIC_APPLICATION_BUCKET,
  PUBLIC_JOB_FIELDS,
  ACTIVE_APPLICATION_STATUSES,
  clean,
  cleanMultiline,
  parseStringArray,
  indiaDate,
  isDateOnly,
  hasCompletePublicListing,
  publicJobState,
  isPublicJobEligible,
  publicRoleDto,
  buildPublicSlug,
  publicJobPayload,
  publicJobDetailsChanged,
  validatePublicJobForPublish,
  allocatePublicSlug,
  listEligiblePublicJobs,
  countEligiblePublicJobs,
  getPublicJobBySlug,
  normalizeEmail,
  normalizeMobile,
  normalizedMobileIdentity,
  validatePublicApplication,
  publicApplicationPayload,
  activeApplicationDuplicate,
  stagedResumePath,
  stagePublicApplication,
  validateStagedResumePath,
  adoptStagedResume,
  removeAdoptedResumeIfUnreferenced,
  parsedResumeDto
}
