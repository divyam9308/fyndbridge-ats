const PUBLIC_API_ROOT = '/api/public'

export class PublicApiError extends Error {
  constructor(message, { status = 0, code = '', payload = null } = {}) {
    super(message)
    this.name = 'PublicApiError'
    this.status = status
    this.code = code
    this.payload = payload
  }
}

async function publicJson(url, init = {}) {
  const response = await window.fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new PublicApiError(
      payload.error || payload.message || 'Unable to complete this request. Please try again.',
      { status: response.status, code: payload.code || '', payload }
    )
  }
  return payload
}

export async function fetchPublicRoles({ signal } = {}) {
  const payload = await publicJson(`${PUBLIC_API_ROOT}/open-roles`, { signal })
  return Array.isArray(payload.data) ? payload.data : []
}

export async function fetchPublicRole(slug, { signal } = {}) {
  const payload = await publicJson(`${PUBLIC_API_ROOT}/open-roles/${encodeURIComponent(slug)}`, { signal })
  return payload.data || null
}

export async function parsePublicResume(file, { signal } = {}) {
  const body = new FormData()
  body.append('resume', file)
  const payload = await publicJson(`${PUBLIC_API_ROOT}/applications/parse-resume`, {
    method: 'POST',
    body,
    signal,
  })
  return {
    data: payload.data || {},
    formToken: String(payload.form_token || ''),
    formStartedAt: String(payload.form_started_at || ''),
  }
}

export async function submitPublicApplication({ roleSlug, resume, applicant, website = '', formToken, formStartedAt, captchaToken = '' }) {
  const body = new FormData()
  body.append('role_slug', roleSlug)
  body.append('resume', resume)
  body.append('full_name', applicant.full_name)
  body.append('email', applicant.email)
  body.append('mobile_number', applicant.mobile_number)
  body.append('current_designation', applicant.current_designation)
  body.append('current_organisation', applicant.current_organisation)
  body.append('experience_years', applicant.experience_years)
  body.append('location', applicant.location)
  body.append('skills', JSON.stringify(applicant.skills))
  body.append('notice_period', applicant.notice_period)
  body.append('current_salary', applicant.current_salary)
  body.append('linkedin_url', applicant.linkedin_url)
  body.append('open_to_relocate', applicant.open_to_relocate)
  body.append('comments', applicant.comments)
  body.append('website', website)
  body.append('form_token', String(formToken || ''))
  body.append('form_started_at', String(formStartedAt || ''))
  if (captchaToken) body.append('captcha_token', captchaToken)

  return publicJson(`${PUBLIC_API_ROOT}/applications`, { method: 'POST', body })
}
