/**
 * Maps a raw candidate row from the API (Supabase snake_case) to the
 * camelCase UI shape expected by all pages.
 */
import { candidateStatusFormValue } from './candidateStatuses'
import { normalizeAttachments } from './documentAttachments'
import { STORAGE_BUCKETS } from './storageBuckets'

export const apiCandidateToUi = (row) => ({
  id: row.association_id || row.id,
  associationId: row.association_id || row.id,
  candidateId: row.candidate_id,
  clientId: row.client_id || '',
  clientDisplayId: row.client_display_id || '',
  jobId: row.job_id || '',
  jobDisplayId: row.job_display_id || '',
  candidateDisplayId: row.candidate_display_id || '',
  name: row.full_name || '',
  email: row.email || '',
  mobile: row.mobile_number || '',
  city: row.city || '',
  state: row.state || '',
  location: row.location || '',
  designation: row.current_designation || '',
  currentCompany: row.current_company || '',
  currentOrganisation: row.current_organisation || row.current_company || '',
  exp: row.experience_years ?? '',
  noticePeriod: row.notice_period ?? '',
  openToRelocate: row.open_to_relocate === null || row.open_to_relocate === undefined || row.open_to_relocate === '' ? '' : (row.open_to_relocate === 'NA' ? 'NA' : (row.open_to_relocate === true || row.open_to_relocate === 'true' || row.open_to_relocate === 'Yes' ? 'Yes' : 'No')),
  salary: row.current_salary ?? '',
  expectedSalary: row.expected_salary ?? '',
  offeredCtc: row.offered_ctc ?? '',
  dateOfJoining: row.date_of_joining || '',
  skills: row.skills || [],
  education: row.education || '',
  client: row.client_name || '',
  clientPhone: row.client_phone_number || '',
  job: row.job_title || '',
  status: candidateStatusFormValue(row.status),
  cvLink: row.cv_link || row.resume_url || '',
  cvFileHash: row.cv_file_hash || '',
  cvStoragePath: row.cv_storage_path || row.resume_path || '',
  cvOriginalName: row.cv_original_name || row.file_name || '',
  cvMimetype: row.cv_mimetype || '',
  cvAttachments: candidateCvAttachments(row),
  linkedinUrl: row.linkedin_url || '',
  notes: row.notes || '',
  consultant: row.consultant_name || '',
  consultantName: row.consultant_name || '',
  consultantUserId: row.consultant_user_id || '',
  createdAt: row.created_at || '',
})

export const CV_BUCKET_NAME = STORAGE_BUCKETS.CV
const LEGACY_CV_BUCKET_NAMES = ['resumes', 'resume', 'cvs', 'cv', 'candidate-cvs', 'candidate_cvs']

export const cleanCandidateCvPath = (value) => {
  const text = String(value || '').trim()
  if (!text || text === '-' || text.startsWith('/tmp/')) return ''
  let path = text
  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      const marker = '/storage/v1/object/'
      const index = parsed.pathname.indexOf(marker)
      if (index === -1) return ''
      path = decodeURIComponent(parsed.pathname.slice(index + marker.length))
    } catch {
      return ''
    }
  }
  path = path.replace(/^public\//, '').replace(/^sign\//, '')
  let changed = true
  while (changed) {
    changed = false
    for (const bucket of LEGACY_CV_BUCKET_NAMES) {
      if (path.startsWith(`${bucket}/`)) {
        path = path.slice(bucket.length + 1)
        changed = true
      }
    }
  }
  return path
}

export const candidateCvAttachments = (candidate) => {
  const cvStoragePath = candidate?.cvStoragePath || candidate?.cv_storage_path || candidate?.resumePath || candidate?.resume_path || ''
  const cvLink = candidate?.cvLink || candidate?.cv_link || candidate?.resumeUrl || candidate?.resume_url || ''
  const externalStoragePath = /^https?:\/\//i.test(String(cvStoragePath).trim()) ? String(cvStoragePath).trim() : ''
  const externalCvLink = /^https?:\/\//i.test(String(cvLink).trim()) ? String(cvLink).trim() : ''
  const legacyPath = cleanCandidateCvPath(cvStoragePath) || externalStoragePath || externalCvLink
  const attachments = normalizeAttachments(candidate?.cvAttachments ?? candidate?.cv_attachments, {
    path: legacyPath,
    name: candidate?.cvOriginalName || candidate?.cv_original_name || candidate?.fileName || candidate?.file_name || '',
    mime_type: candidate?.cvMimetype || candidate?.cv_mimetype || ''
  })

  const seen = new Set()
  return attachments.reduce((result, attachment) => {
    const protectedPath = cleanCandidateCvPath(attachment.path)
    const path = protectedPath || attachment.path
    if (!path || seen.has(path)) return result
    seen.add(path)
    result.push({ ...attachment, path })
    return result
  }, [])
}

export const getCandidateCvOpenInfo = (candidate) => {
  const cvUrl = String(candidate?.cvLink || '').trim()
  const cvStoragePath = String(candidate?.cvStoragePath || '').trim()
  const storagePath = cleanCandidateCvPath(cvStoragePath)

  if (storagePath) {
    return {
      candidateId: candidate?.candidateId || candidate?.id || '',
      cvUrl,
      cvStoragePath,
      cleanPath: storagePath,
      bucketName: CV_BUCKET_NAME,
      sourceType: 'supabase-storage',
      finalUrl: ''
    }
  }

  if (/^https?:\/\//i.test(cvUrl)) {
    return {
      candidateId: candidate?.candidateId || candidate?.id || '',
      cvUrl,
      cvStoragePath,
      cleanPath: '',
      bucketName: '',
      sourceType: 'external-link',
      finalUrl: ''
    }
  }

  return {
    candidateId: candidate?.candidateId || candidate?.id || '',
    cvUrl,
    cvStoragePath,
    cleanPath: '',
    bucketName: CV_BUCKET_NAME,
    sourceType: 'missing-cv',
    finalUrl: ''
  }
}

export const resolveCandidateCvHref = (candidate) => {
  return getCandidateCvOpenInfo(candidate).cleanPath
}

export const logCandidateCvOpen = (candidate) => {
  if (import.meta.env?.DEV) console.log('[CV open]', { candidateId: candidate?.candidateId || candidate?.id || '' })
}
export { normalizeExternalUrl, openExternalUrl, openProtectedDocumentPath } from '../services/apiClient'
