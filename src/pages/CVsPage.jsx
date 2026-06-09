import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, FileText, Loader2, Pencil, Plus, Upload, X } from 'lucide-react'
import '../styles/Shared.css'

const MAX_FILES = 10
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx']
const EMPTY_CANDIDATE_DRAFT = {
  full_name: '',
  mobile_number: '',
  email: '',
  current_designation: '',
  current_organisation: '',
  current_company: '',
  experience_years: '',
  city: '',
  state: '',
  location: '',
  notice_period: '',
  current_salary: '',
  expected_salary: '',
  open_to_relocate: false,
  skills: '',
  education: '',
  linkedin_url: '',
  resume_url: '',
  cv_link: '',
  client_name: '',
  job_title: '',
  consultant_name: '',
  status: 'Interested',
  notes: ''
}

const emptyRow = {
  temp_id: '',
  serial_no: 1,
  file_name: '',
  candidate_name: '',
  phone_number: '',
  email: '',
  current_designation: '',
  current_organization: '',
  experience_years: '',
  resume_path: '',
  resume_url: '',
  imported: false,
  imported_candidate_id: ''
}

const normalizeRow = (row, index) => ({
  ...emptyRow,
  ...row,
  temp_id: row.temp_id || `cv-${Date.now()}-${index}`,
  serial_no: index + 1,
  candidate_name: row.candidate_name || '',
  phone_number: row.phone_number || '',
  email: row.email || '',
  current_designation: row.current_designation || '',
  current_organization: row.current_organization || '',
  experience_years: row.experience_years ?? '',
  resume_path: row.resume_path || '',
  resume_url: row.resume_url || '',
  imported: Boolean(row.imported),
  imported_candidate_id: row.imported_candidate_id || '',
  error: row.error || row.parse_error || ''
})

export default function CVsPage() {
  const fileInputRef = useRef(null)
  const [parsedRows, setParsedRows] = useState([])
  const [reviewRows, setReviewRows] = useState([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeVisible, setNoticeVisible] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cvDuplicate, setCvDuplicate] = useState(null)
  const [pendingCvRows, setPendingCvRows] = useState(null)
  const [selectedCvRowIds, setSelectedCvRowIds] = useState([])
  const [importQueue, setImportQueue] = useState([])
  const [currentImportIndex, setCurrentImportIndex] = useState(0)
  const [activeImportRow, setActiveImportRow] = useState(null)
  const [activeDuplicate, setActiveDuplicate] = useState(null)
  const [importMode, setImportMode] = useState(null)
  const [candidateDraft, setCandidateDraft] = useState(EMPTY_CANDIDATE_DRAFT)
  const [candidateDraftError, setCandidateDraftError] = useState('')
  const [aiParsingDraft, setAiParsingDraft] = useState(false)
  const [aiParsedDraft, setAiParsedDraft] = useState(false)
  const [importSummary, setImportSummary] = useState({ imported: 0, updated: 0, skipped: 0, failed: 0 })

  useEffect(() => {
    const loadCvs = async () => {
      try {
        const response = await fetch('/api/cvs')
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load CVs.')
        }

        setParsedRows((payload.data || []).map(normalizeRow))
      } catch (err) {
        setError(err.message)
      }
    }

    loadCvs()
  }, [])

  useEffect(() => {
    if (!reviewOpen && !editRow) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [editRow, reviewOpen])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const showTimer = window.setTimeout(() => setNoticeVisible(true), 0)
    const hideTimer = window.setTimeout(() => setNoticeVisible(false), 10000)
    const clearTimer = window.setTimeout(() => setNotice(''), 10400)

    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      window.clearTimeout(clearTimer)
    }
  }, [notice])

  const dismissNotice = () => {
    setNoticeVisible(false)
    window.setTimeout(() => setNotice(''), 380)
  }

  const selectedRows = parsedRows.filter((row) => selectedCvRowIds.includes(row.id || row.temp_id))
  const allRowsSelected = parsedRows.length > 0 && selectedCvRowIds.length === parsedRows.length

  const rowId = (row) => row.id || row.temp_id

  const cvRowToDraft = (row, existing = null) => ({
    ...EMPTY_CANDIDATE_DRAFT,
    full_name: existing?.full_name || row.candidate_name || '',
    mobile_number: existing?.mobile_number || row.phone_number || '',
    email: existing?.email || row.email || '',
    current_designation: existing?.current_designation || row.current_designation || '',
    current_organisation: existing?.current_organisation || row.current_organization || '',
    current_company: existing?.current_company || row.current_organization || '',
    experience_years: existing?.experience_years ?? row.experience_years ?? '',
    city: existing?.city || '',
    state: existing?.state || '',
    location: existing?.location || '',
    notice_period: existing?.notice_period ?? '',
    current_salary: '',
    expected_salary: '',
    open_to_relocate: Boolean(existing?.open_to_relocate),
    skills: Array.isArray(existing?.skills) ? existing.skills.join(', ') : '',
    education: existing?.education || '',
    linkedin_url: existing?.linkedin_url || '',
    resume_url: existing?.resume_url || row.resume_url || '',
    cv_link: existing?.cv_link || row.resume_url || '',
    consultant_name: '',
    status: 'Interested',
    notes: ''
  })

  const candidateDraftPayload = (duplicateAction = '', existingId = '') => ({
    ...candidateDraft,
    skills: candidateDraft.skills.split(',').map((skill) => skill.trim()).filter(Boolean),
    experience_years: candidateDraft.experience_years === '' ? null : Number(candidateDraft.experience_years),
    notice_period: candidateDraft.notice_period === '' ? null : Number(candidateDraft.notice_period),
    current_salary: candidateDraft.current_salary === '' ? null : Number(candidateDraft.current_salary),
    expected_salary: candidateDraft.expected_salary === '' ? null : Number(candidateDraft.expected_salary),
    duplicate_action: duplicateAction || undefined,
    existing_id: existingId || undefined,
    source: 'cv_import'
  })

  const finishImportQueue = (summary = importSummary) => {
    setImporting(false)
    setImportQueue([])
    setCurrentImportIndex(0)
    setActiveImportRow(null)
    setActiveDuplicate(null)
    setImportMode(null)
    setCandidateDraft(EMPTY_CANDIDATE_DRAFT)
    setAiParsingDraft(false)
    setAiParsedDraft(false)
    setNotice(`Import completed: ${summary.imported} imported, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed.`)
  }

  const processNextImportRow = async (queue = importQueue, index = currentImportIndex, summary = importSummary) => {
    if (index >= queue.length) {
      finishImportQueue(summary)
      return
    }

    const row = queue[index]
    setCurrentImportIndex(index)
    setActiveImportRow(row)
    setActiveDuplicate(null)
    setCandidateDraftError('')
    setAiParsingDraft(false)
    setAiParsedDraft(false)

    const name = String(row.candidate_name || '').trim()
    const email = String(row.email || '').trim()

    if (!name || !email) {
      setCandidateDraft(cvRowToDraft(row))
      setImportMode('create')
      return
    }

    try {
      const response = await fetch(`/api/candidates/check-duplicate?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`)
      const payload = await response.json().catch(() => ({}))

      if (response.ok && payload.duplicate) {
        setActiveDuplicate({ existing: payload.existing, row })
        return
      }

      setCandidateDraft(cvRowToDraft(row))
      setImportMode('create')
    } catch {
      setCandidateDraft(cvRowToDraft(row))
      setImportMode('create')
    }
  }

  const startImport = (rowsToImport) => {
    if (!rowsToImport.length) return
    const summary = { imported: 0, updated: 0, skipped: 0, failed: 0 }
    setImportSummary(summary)
    setImportQueue(rowsToImport)
    setImporting(true)
    processNextImportRow(rowsToImport, 0, summary)
  }

  const continueImport = (summaryKey) => {
    const nextSummary = { ...importSummary, [summaryKey]: importSummary[summaryKey] + 1 }
    const nextIndex = currentImportIndex + 1
    setImportSummary(nextSummary)
    setImportMode(null)
    setActiveDuplicate(null)
    setCandidateDraft(EMPTY_CANDIDATE_DRAFT)
    setAiParsingDraft(false)
    setAiParsedDraft(false)
    processNextImportRow(importQueue, nextIndex, nextSummary)
  }

  const openUpload = () => fileInputRef.current?.click()

  const validateFiles = (files) => {
    if (!files.length) return 'Select at least one resume.'
    if (files.length > MAX_FILES) return 'Upload up to 10 resumes at once.'

    const invalid = files.find((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase()
      return !ACCEPTED_EXTENSIONS.includes(extension)
    })

    if (invalid) return 'Only PDF, DOC, and DOCX files are accepted.'

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) return 'Each resume must be 10MB or smaller.'

    return ''
  }

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    setError('')
    setNotice('')

    const validationError = validateFiles(files)
    if (validationError) {
      setError(validationError)
      return
    }

    const body = new FormData()
    files.forEach((file) => body.append('resumes', file))

    try {
      setParsing(true)

      const response = await fetch('/api/resumes/bulk-parse', {
        method: 'POST',
        body
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to parse resumes.')
      }

      setReviewRows((payload.rows || []).map(normalizeRow))
      setReviewOpen(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const updateReviewRow = (tempId, field, value) => {
    setReviewRows((rows) =>
      rows.map((row) =>
        row.temp_id === tempId ? { ...row, [field]: value } : row
      )
    )
  }

  const saveReviewRow = (tempId) => {
    setReviewRows((rows) =>
      rows.map((row) =>
        row.temp_id === tempId ? { ...row } : row
      )
    )
    setNotice('Resume saved locally.')
  }

  const duplicateKey = (row) => {
    const name = String(row.candidate_name || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const email = String(row.email || '').trim().toLowerCase()
    return name && email ? `${name}|${email}` : ''
  }

  const findNextCvDuplicate = (rows) => {
    const seen = new Map(parsedRows.map((row) => [duplicateKey(row), row]).filter(([key]) => key))

    for (const row of rows) {
      const key = duplicateKey(row)
      if (!key) continue
      if (seen.has(key)) return { existing: seen.get(key), incoming: row }
      seen.set(key, row)
    }

    return null
  }

  const persistCvRows = async (rows) => {
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/cvs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map((row) => ({ ...row, reviewed: true })) })
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save CV rows.')
      }

      const savedRows = (payload.data || []).map(normalizeRow)
      setParsedRows((rows) => [...savedRows, ...rows])
      setReviewOpen(false)
      setNotice('Reviewed CVs saved.')
    } catch (err) {
      setError(err.message)
    }
  }

  const saveAll = async () => {
    const rows = reviewRows.map(normalizeRow)
    const duplicate = findNextCvDuplicate(rows)

    if (duplicate) {
      setPendingCvRows(rows)
      setCvDuplicate(duplicate)
      return
    }

    await persistCvRows(rows)
  }

  const resolveCvDuplicate = async (action) => {
    const rows = pendingCvRows || []
    const incomingId = cvDuplicate?.incoming?.temp_id
    const existing = cvDuplicate?.existing
    let nextRows = rows.filter((row) => row.temp_id !== incomingId)

    if (action === 'update_current' && existing) {
      if (existing.id) {
        const response = await fetch(`/api/cvs/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cvDuplicate.incoming, id: existing.id })
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) {
          const saved = normalizeRow(payload, existing.serial_no - 1)
          setParsedRows((currentRows) => currentRows.map((row) => row.id === saved.id ? saved : row))
        } else {
          setError(payload.error || 'Unable to update duplicate CV.')
        }
      } else {
        setParsedRows((currentRows) => currentRows.map((row) => row.temp_id === existing.temp_id ? { ...cvDuplicate.incoming, temp_id: existing.temp_id } : row))
      }
    }

    const duplicate = findNextCvDuplicate(nextRows)
    if (duplicate) {
      setPendingCvRows(nextRows)
      setCvDuplicate(duplicate)
      return
    }

    setCvDuplicate(null)
    setPendingCvRows(null)
    if (!nextRows.length) {
      setReviewOpen(false)
      setNotice('Duplicate CV rows resolved.')
      return
    }
    await persistCvRows(nextRows)
  }

  const openEdit = (row) => setEditRow({ ...row })

  const updateEditRow = (field, value) => {
    setEditRow((row) => ({ ...row, [field]: value }))
  }

  const saveEditRow = async () => {
    setError('')
    setNotice('')

    try {
      if (!editRow.id) {
        setParsedRows((rows) => rows.map((row) => row.temp_id === editRow.temp_id ? { ...editRow } : row))
        setEditRow(null)
        setNotice('CV updated locally.')
        return
      }

      const response = await fetch(`/api/cvs/${editRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editRow)
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update CV row.')
      }

      const saved = normalizeRow(payload, editRow.serial_no - 1)
      setParsedRows((rows) => rows.map((row) => row.id === saved.id ? saved : row))
      setEditRow(null)
      setNotice('CV updated.')
    } catch (err) {
      setError(err.message)
    }
  }

  const markCvImported = async (row, candidatePayload) => {
    if (!row?.id) return

    const response = await fetch(`/api/cvs/${row.id}/imported`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: candidatePayload.candidate_id || candidatePayload.id })
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setParsedRows((rows) => rows.map((item) => item.id === row.id ? normalizeRow(payload, item.serial_no - 1) : item))
    }
  }

  const skipCurrentImportRow = () => {
    continueImport('skipped')
  }

  const handleDuplicateUpdateExisting = () => {
    setCandidateDraft(cvRowToDraft(activeDuplicate.row, activeDuplicate.existing))
    setAiParsedDraft(false)
    setImportMode('update')
  }

  const handleDuplicateAddDuplicate = () => {
    setCandidateDraft(cvRowToDraft(activeDuplicate.row))
    setAiParsedDraft(false)
    setImportMode('create_duplicate')
  }

  const applyParsedResumeToEmptyFields = (payload) => {
    const extracted = payload.extracted || {}
    const ai = payload.ai_extracted || {}
    const parsedDraft = {
      full_name: ai.name || extracted.full_name?.value || '',
      mobile_number: ai.mobile || extracted.mobile_number?.value || '',
      email: ai.email || extracted.email?.value || '',
      current_designation: ai.currentDesignation || extracted.current_designation?.value || '',
      current_organisation: ai.currentOrganisation || extracted.current_organisation?.value || '',
      current_company: ai.currentOrganisation || extracted.current_organisation?.value || '',
      experience_years: ai.experience ?? extracted.experience_years?.value ?? '',
      city: ai.city || extracted.city?.value || '',
      state: ai.state || extracted.state?.value || '',
      location: ai.location || extracted.location?.value || '',
      skills: Array.isArray(ai.skills) && ai.skills.length ? ai.skills.join(', ') : Array.isArray(extracted.skills?.value) ? extracted.skills.value.join(', ') : '',
      education: ai.education || extracted.education?.value || '',
      linkedin_url: ai.linkedin || ''
    }

    setCandidateDraft((draft) => ({
      ...draft,
      ...Object.fromEntries(
        Object.entries(parsedDraft).map(([key, value]) => [key, draft[key] ? draft[key] : value])
      )
    }))
  }

  const aiParseActiveResume = async () => {
    const resumeUrl = activeImportRow?.resume_url || (activeImportRow?.resume_path ? `${window.location.origin}/api/resumes/open/${encodeURIComponent(activeImportRow.resume_path)}` : '')
    if (!resumeUrl) return

    setCandidateDraftError('')
    setAiParsingDraft(true)
    setAiParsedDraft(false)
    try {
      const response = await fetch('/api/candidates/parse-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_url: resumeUrl })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Resume parsing failed.')
      applyParsedResumeToEmptyFields(payload)
      setAiParsedDraft(true)
    } catch (err) {
      setCandidateDraftError(err.message)
    } finally {
      setAiParsingDraft(false)
    }
  }

  const saveCandidateFromCv = async () => {
    if (!candidateDraft.full_name.trim()) {
      setCandidateDraftError('Full Name is required.')
      return
    }
    if (!candidateDraft.mobile_number.trim()) {
      setCandidateDraftError('Mobile Number is required.')
      return
    }

    const isUpdate = importMode === 'update'
    const duplicateAction = importMode === 'create_duplicate' ? 'add_duplicate' : isUpdate ? 'update_existing' : ''
    const existingId = isUpdate ? activeDuplicate?.existing?.id : ''

    try {
      const response = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidateDraftPayload(duplicateAction, existingId))
      })
      const payload = await response.json().catch(() => ({}))

      if (response.status === 409 && payload.duplicate) {
        setActiveDuplicate({ existing: payload.existing, row: activeImportRow })
        setImportMode(null)
        return
      }

      if (!response.ok) {
        throw new Error(payload.error || Object.values(payload.errors || {})[0] || 'Unable to save candidate.')
      }

      await markCvImported(activeImportRow, payload)
      continueImport(isUpdate ? 'updated' : 'imported')
    } catch (err) {
      setCandidateDraftError(err.message)
    }
  }

  const renderFields = (row, onChange) => (
    <div className="resume-fields-grid">
      <div className="form-group full">
        <label className="form-label">Resume File Name</label>
        <input className="form-control" value={row.file_name} disabled />
      </div>

      <div className="form-group">
        <label className="form-label">Candidate Name</label>
        <input
          className="form-control"
          value={row.candidate_name}
          onChange={(e) => onChange('candidate_name', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Phone Number</label>
        <input
          className="form-control"
          value={row.phone_number}
          onChange={(e) => onChange('phone_number', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Email</label>
        <input
          className="form-control"
          type="email"
          value={row.email}
          onChange={(e) => onChange('email', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Current Designation</label>
        <input
          className="form-control"
          value={row.current_designation}
          onChange={(e) => onChange('current_designation', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Current Organization</label>
        <input
          className="form-control"
          value={row.current_organization}
          onChange={(e) => onChange('current_organization', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Experience Years</label>
        <input
          className="form-control"
          type="number"
          min="0"
          step="0.1"
          value={row.experience_years}
          onChange={(e) => onChange('experience_years', e.target.value)}
        />
      </div>
    </div>
  )

  const reviewModal = reviewOpen ? createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && setReviewOpen(false)}
    >
      <div className="review-modal" role="dialog" aria-modal="true" aria-label="Review parsed CVs">
        <div className="review-modal-header">
          <div>
            <h2>Review Parsed CVs</h2>
            <p>Check and edit extracted details before saving</p>
          </div>

          <button
            className="modal-close"
            type="button"
            onClick={() => setReviewOpen(false)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="review-modal-body">
          {reviewRows.map((row, index) => (
            <section className="resume-review-card" key={row.temp_id}>
              <div className="cv-review-heading">
                <div>
                  <div className="name-text">Resume {index + 1}</div>
                  <div className="sub-text">{row.file_name}</div>
                </div>
              </div>

              {row.error && (
                <div className="review-banner">
                  <AlertCircle size={16} /> {row.error}
                </div>
              )}

              {renderFields(row, (field, value) => updateReviewRow(row.temp_id, field, value))}

              <div className="resume-review-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => saveReviewRow(row.temp_id)}
                >
                  Save
                </button>
              </div>
            </section>
          ))}
        </div>

        <div className="review-modal-footer">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setReviewOpen(false)}
          >
            Cancel
          </button>

          <button
            className="btn-primary"
            type="button"
            onClick={saveAll}
          >
            Save All
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  const editModal = editRow ? createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && setEditRow(null)}
    >
      <div className="review-modal review-modal-sm" role="dialog" aria-modal="true" aria-label="Edit CV">
        <div className="review-modal-header">
          <div>
            <h2>Edit CV</h2>
            <p>Update reviewed candidate details</p>
          </div>

          <button
            className="modal-close"
            type="button"
            onClick={() => setEditRow(null)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="review-modal-body">
          {renderFields(editRow, updateEditRow)}
        </div>

        <div className="review-modal-footer">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setEditRow(null)}
          >
            Cancel
          </button>

          <button
            className="btn-primary"
            type="button"
            onClick={saveEditRow}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  const cvDuplicateModal = cvDuplicate ? createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && setCvDuplicate(null)}
    >
      <div className="review-modal review-modal-sm" role="dialog" aria-modal="true" aria-label="Duplicate CV">
        <div className="review-modal-header">
          <div>
            <h2>Duplicate CV</h2>
            <p>A CV with the same candidate name and email already exists.</p>
          </div>

          <button
            className="modal-close"
            type="button"
            onClick={() => setCvDuplicate(null)}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="review-modal-body">
          <div className="duplicate-compare-grid">
            <div className="duplicate-compare-card">
              <div className="form-section-title">Existing CV</div>
              <div className="name-text">{cvDuplicate.existing?.candidate_name || '-'}</div>
              <div className="sub-text">{cvDuplicate.existing?.email || '-'}</div>
              <div className="sub-text">{cvDuplicate.existing?.file_name || '-'}</div>
            </div>
            <div className="duplicate-compare-card">
              <div className="form-section-title">New CV</div>
              <div className="name-text">{cvDuplicate.incoming?.candidate_name || '-'}</div>
              <div className="sub-text">{cvDuplicate.incoming?.email || '-'}</div>
              <div className="sub-text">{cvDuplicate.incoming?.file_name || '-'}</div>
            </div>
          </div>
        </div>

        <div className="review-modal-footer">
          <button className="btn-secondary" type="button" onClick={() => resolveCvDuplicate('remove_new')}>
            Remove New Duplicate Entry
          </button>
          <button className="btn-primary" type="button" onClick={() => resolveCvDuplicate('update_current')}>
            Update Current Entry
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  const importDuplicateModal = activeDuplicate && !importMode ? createPortal(
    <div className="modal-backdrop">
      <div className="review-modal review-modal-sm" role="dialog" aria-modal="true" aria-label="Duplicate Candidate Found">
        <div className="review-modal-header">
          <div>
            <h2>Duplicate Candidate Found</h2>
            <p>A candidate with the same name and email already exists.</p>
          </div>
          <button className="modal-close" type="button" onClick={skipCurrentImportRow} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="review-modal-body">
          <div className="duplicate-compare-grid">
            <div className="duplicate-compare-card">
              <div className="form-section-title">Existing Candidate</div>
              <div className="name-text">{activeDuplicate.existing?.full_name || '-'}</div>
              <div className="sub-text">{activeDuplicate.existing?.email || '-'}</div>
              <div className="sub-text">{activeDuplicate.existing?.mobile_number || '-'}</div>
            </div>
            <div className="duplicate-compare-card">
              <div className="form-section-title">New CV Row</div>
              <div className="name-text">{activeDuplicate.row?.candidate_name || '-'}</div>
              <div className="sub-text">{activeDuplicate.row?.email || '-'}</div>
              <div className="sub-text">{activeDuplicate.row?.phone_number || '-'}</div>
            </div>
          </div>
        </div>
        <div className="review-modal-footer">
          <button className="btn-secondary" type="button" onClick={skipCurrentImportRow}>Cancel / Skip</button>
          <button className="btn-secondary" type="button" onClick={handleDuplicateAddDuplicate}>Add Duplicate Entry</button>
          <button className="btn-primary" type="button" onClick={handleDuplicateUpdateExisting}>Update Current Entry</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  const candidateImportModal = importMode ? createPortal(
    <div className="modal-backdrop">
      <div className="review-modal" role="dialog" aria-modal="true" aria-label={importMode === 'update' ? 'Update Existing Candidate' : 'Create Candidate from CV'}>
        <div className="review-modal-header">
          <div>
            <h2>{importMode === 'update' ? 'Update Existing Candidate' : 'Create Candidate from CV'}</h2>
            <p>Importing {Math.min(currentImportIndex + 1, importQueue.length)} of {importQueue.length}</p>
          </div>
          <button className="modal-close" type="button" onClick={skipCurrentImportRow} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="review-modal-body">
          {candidateDraftError && <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>{candidateDraftError}</div>}
          <div className="form-grid-2">
            {[
              ['full_name', 'Full Name', 'text'],
              ['mobile_number', 'Mobile Number', 'text'],
              ['email', 'Email', 'email'],
              ['current_designation', 'Current Designation', 'text'],
              ['current_organisation', 'Current Organization', 'text'],
              ['experience_years', 'Experience Years', 'number'],
              ['city', 'City', 'text'],
              ['state', 'State', 'text'],
              ['location', 'Location', 'text'],
              ['notice_period', 'Notice Period', 'number'],
              ['current_salary', 'Current Salary', 'number'],
              ['expected_salary', 'Expected Salary', 'number'],
              ['linkedin_url', 'LinkedIn URL', 'text'],
              ['resume_url', 'Resume URL', 'text'],
              ['client_name', 'Client', 'text'],
              ['job_title', 'Job', 'text'],
              ['consultant_name', 'Consultant', 'text'],
              ['status', 'Status', 'text']
            ].map(([field, label, type]) => (
              <div className="form-group" key={field}>
                <label className="form-label">{label}</label>
                <input
                  className="form-control"
                  type={type}
                  value={candidateDraft[field]}
                  onChange={(event) => setCandidateDraft((draft) => ({ ...draft, [field]: event.target.value }))}
                />
              </div>
            ))}
            <label className="filter-toggle" style={{ alignSelf: 'end', height: 38 }}>
              <input
                type="checkbox"
                checked={candidateDraft.open_to_relocate}
                onChange={(event) => setCandidateDraft((draft) => ({ ...draft, open_to_relocate: event.target.checked }))}
              />
              Open to Relocate
            </label>
            <div className="form-group full">
              <label className="form-label">Skills</label>
              <input className="form-control" value={candidateDraft.skills} onChange={(event) => setCandidateDraft((draft) => ({ ...draft, skills: event.target.value }))} />
            </div>
            <div className="form-group full">
              <label className="form-label">Education</label>
              <textarea className="form-control" rows={3} value={candidateDraft.education} onChange={(event) => setCandidateDraft((draft) => ({ ...draft, education: event.target.value }))} />
            </div>
            <div className="form-group full">
              <label className="form-label">Notes</label>
              <textarea className="form-control" rows={3} value={candidateDraft.notes} onChange={(event) => setCandidateDraft((draft) => ({ ...draft, notes: event.target.value }))} />
            </div>
          </div>
        </div>
        <div className="review-modal-footer">
          {(activeImportRow?.resume_path || activeImportRow?.resume_url) && (
            <button className="btn-secondary" type="button" onClick={aiParseActiveResume} disabled={aiParsingDraft}>
              {aiParsingDraft && <Loader2 size={14} className="spin" />}
              {!aiParsingDraft && aiParsedDraft && <Check size={14} />}
              AI Parse Resume
            </button>
          )}
          <button className="btn-secondary" type="button" onClick={skipCurrentImportRow}>Cancel / Skip</button>
          <button className="btn-primary" type="button" onClick={saveCandidateFromCv}>
            {importMode === 'update' ? 'Update Candidate' : 'Save Candidate'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <>
      <div>
        <div className="page-header cvs-page-header">
          <div className="page-subtitle">Upload, review, and manage candidate CVs</div>

          <div className="row-actions" style={{ opacity: 1 }}>
            {parsedRows.length > 0 && (
              <button
                className="btn-secondary"
                type="button"
                onClick={() => startImport(selectedRows)}
                disabled={importing || selectedRows.length === 0}
              >
                {importing ? <Loader2 size={15} className="spin" /> : <Plus size={15} strokeWidth={2.5} />}
                Import Candidates ({selectedRows.length})
              </button>
            )}

            <button
              className="btn-primary"
              type="button"
              onClick={openUpload}
              disabled={parsing}
              id="btn-upload-cvs"
            >
              {parsing ? <Loader2 size={15} className="spin" /> : <Upload size={15} strokeWidth={2.5} />}
              Upload CVs
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept=".pdf,.doc,.docx"
            onChange={handleFiles}
          />
        </div>

        {error && (
          <div className="form-error" style={{ display: 'block', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="table-card">
          {parsedRows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                {parsing ? (
                  <Loader2 size={28} color="var(--gold)" className="spin" />
                ) : (
                  <FileText size={28} color="var(--gold)" strokeWidth={1.5} />
                )}
              </div>

              <div className="empty-state-title">
                {parsing ? 'Parsing CVs...' : 'No CVs uploaded yet'}
              </div>

              {!parsing && (
                <button className="btn-primary" type="button" onClick={openUpload}>
                  <Plus size={15} strokeWidth={2.5} />
                  Upload CVs
                </button>
              )}
            </div>
          ) : (
            <table className="data-table" aria-label="CVs">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allRowsSelected}
                      onChange={(event) => setSelectedCvRowIds(event.target.checked ? parsedRows.map(rowId) : [])}
                    />
                  </th>
                  <th>S.No</th>
                  <th>Candidate Name</th>
                  <th>Phone Number</th>
                  <th>Email</th>    
                  <th>Current Designation</th>
                  <th>Current Organization</th>
                  <th>Experience Years</th>
                  <th>Resume File</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {parsedRows.map((row) => (
                  <tr key={row.temp_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedCvRowIds.includes(rowId(row))}
                        onChange={(event) => {
                          const id = rowId(row)
                          setSelectedCvRowIds((ids) => event.target.checked ? [...ids, id] : ids.filter((item) => item !== id))
                        }}
                      />
                    </td>
                    <td>{row.serial_no}</td>

<td>{row.candidate_name || '-'}</td>

<td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>
  {row.phone_number || '-'}
</td>

<td style={{ color: 'var(--info)', fontSize: 12.5 }}>
  {row.email || '-'}
</td>

<td>{row.current_designation || '-'}</td>

<td>{row.current_organization || '-'}</td>

<td>{row.experience_years === '' ? '-' : row.experience_years}</td>

<td>
  {row.resume_path ? (
    <a
      href={`/api/resumes/open/${encodeURIComponent(row.resume_path)}`}
      target="_blank"
      rel="noreferrer"
      className="cv-table-link"
    >
      {row.file_name}
    </a>
  ) : row.resume_url ? (
    <a
      href={row.resume_url}
      target="_blank"
      rel="noreferrer"
      className="cv-table-link"
    >
      {row.file_name}
    </a>
  ) : (
    <span className="name-text">{row.file_name}</span>
  )}
</td>

                    <td>
                      <div className="row-actions">
                        <button
                          className="row-action-btn"
                          type="button"
                          title="Edit"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {reviewModal}
      {editModal}
      {cvDuplicateModal}
      {importDuplicateModal}
      {candidateImportModal}
      {notice && (
        <div className={`notice-toast ${noticeVisible ? 'is-visible' : 'is-hidden'}`} role="status">
          <FileText size={16} />
          <span>{notice}</span>
          <button className="notice-toast-close" type="button" onClick={dismissNotice} aria-label="Close notification">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  )
}
