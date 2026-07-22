import { apiFetch, openProtectedUrl } from './apiClient'

export class AppliedCandidatesApiError extends Error {
  constructor(message, { status = 0, code = '', payload = null } = {}) {
    super(message)
    this.name = 'AppliedCandidatesApiError'
    this.status = status
    this.code = code
    this.payload = payload
  }
}

async function protectedJson(url, init = {}) {
  const response = await apiFetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new AppliedCandidatesApiError(payload.error || payload.message || 'Unable to complete this request.', {
      status: response.status,
      code: payload.code || '',
      payload,
    })
  }
  return payload
}

export async function fetchAppliedCandidates(filters = {}, { signal } = {}) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) params.set(key, String(value))
  })
  const payload = await protectedJson(`/api/applied-candidates?${params.toString()}`, { signal })
  return {
    rows: Array.isArray(payload.data) ? payload.data : [],
    total: Number(payload.total || 0),
    page: Number(payload.page || filters.page || 1),
    totalPages: Number(payload.totalPages || payload.total_pages || 1),
    limit: Number(payload.limit || filters.limit || 25),
  }
}

export async function fetchAppliedCandidate(id, { signal } = {}) {
  const payload = await protectedJson(`/api/applied-candidates/${encodeURIComponent(id)}`, { signal })
  return payload.data || null
}

export async function convertAppliedCandidate(id, body) {
  const payload = await protectedJson(`/api/applied-candidates/${encodeURIComponent(id)}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return payload.data || payload
}

export async function updateAppliedCandidateStatus(id, status, rejectionReason = '') {
  const payload = await protectedJson(`/api/applied-candidates/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, rejection_reason: rejectionReason }),
  })
  return payload.data || payload
}

export async function openAppliedCandidateCv(id) {
  return openProtectedUrl(`/api/applied-candidates/${encodeURIComponent(id)}/cv`, {
    notFoundMessage: 'The staged application CV could not be opened.',
  })
}
