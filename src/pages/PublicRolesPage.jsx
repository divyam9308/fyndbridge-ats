import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  Star,
  Upload,
  X,
} from 'lucide-react'
import TurnstileWidget from '../components/public/TurnstileWidget'
import PublicJdContent from '../components/PublicJdContent'
import {
  fetchPublicRole,
  fetchPublicRoles,
  parsePublicResume,
  PublicApiError,
  submitPublicApplication,
} from '../services/publicRolesApi'
import './PublicRolesPage.css'

const MAX_PUBLIC_CV_BYTES = 1 * 1024 * 1024
const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()

const EMPTY_APPLICANT = {
  full_name: '',
  email: '',
  mobile_number: '',
  current_designation: '',
  current_organisation: '',
  experience_years: '',
  location: '',
  skills: [],
  notice_period: '',
  current_salary: '',
  linkedin_url: '',
  open_to_relocate: '',
  comments: '',
}

const REQUIRED_LABELS = {
  full_name: 'Candidate Name',
  email: 'Email',
  mobile_number: 'Mobile',
  current_designation: 'Current Designation',
  current_organisation: 'Current Organization',
  experience_years: 'Total Experience',
  location: 'Current Location',
  notice_period: 'Notice Period',
  current_salary: 'Current CTC',
  open_to_relocate: 'Open to Relocate',
}

const clean = value => String(value ?? '').trim()
const releaseNumberInputOnWheel = event => event.currentTarget.blur()
const publicSkills = value => (Array.isArray(value) ? value : String(value || '').split(','))
  .map(clean)
  .filter(Boolean)
  .filter((value, index, values) => values.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)

const publicDate = (value) => {
  if (!value) return '-'
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return String(value)
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day))
}

const parsedApplicant = (data = {}) => ({
  ...EMPTY_APPLICANT,
  full_name: clean(data.full_name),
  email: clean(data.email),
  mobile_number: clean(data.mobile_number),
  current_designation: clean(data.current_designation),
  current_organisation: clean(data.current_organisation),
  experience_years: clean(data.experience_years),
  location: clean(data.location),
  skills: publicSkills(data.skills),
  current_salary: clean(data.current_salary),
  linkedin_url: clean(data.linkedin_url),
})

async function validatePublicCv(file) {
  if (!(file instanceof File)) return 'Select a PDF resume to continue.'
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF resumes are accepted.'
  if (file.type !== 'application/pdf') return 'The selected file does not have a valid PDF MIME type.'
  if (file.size > MAX_PUBLIC_CV_BYTES) return 'The PDF must be 1 MB or smaller.'
  if (!file.size) return 'The selected PDF is empty.'
  const signature = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer())
  if (signature !== '%PDF-') return 'The selected file does not have a valid PDF signature.'
  return ''
}

function validateApplicant(applicant, resume, captchaToken) {
  const errors = {}
  Object.entries(REQUIRED_LABELS).forEach(([key, label]) => {
    if (!clean(applicant[key])) errors[key] = `${label} is required.`
  })
  if (!publicSkills(applicant.skills).length) errors.skills = 'At least one skill is required.'
  if (!resume) errors.resume = 'Resume is required.'
  if (clean(applicant.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(applicant.email))) errors.email = 'Enter a valid email address.'
  if (clean(applicant.mobile_number) && !/^\d{7,15}$/.test(clean(applicant.mobile_number).replace(/\D/g, ''))) errors.mobile_number = 'Enter a valid mobile number.'
  if (clean(applicant.experience_years) && (!Number.isFinite(Number(applicant.experience_years)) || Number(applicant.experience_years) < 0)) errors.experience_years = 'Enter valid experience of zero or more years.'
  const notice = Number(applicant.notice_period)
  if (clean(applicant.notice_period) && (!Number.isInteger(notice) || notice < 0)) errors.notice_period = 'Notice Period must be a non-negative whole number of days.'
  const currentSalary = Number(applicant.current_salary)
  if (clean(applicant.current_salary) && (!Number.isInteger(currentSalary) || currentSalary <= 0 || currentSalary > 999999999)) {
    errors.current_salary = 'CTC must be a positive whole LPA value.'
  }
  if (clean(applicant.linkedin_url)) {
    try {
      const url = new URL(clean(applicant.linkedin_url))
      if (!['http:', 'https:'].includes(url.protocol)) errors.linkedin_url = 'Enter a valid LinkedIn URL.'
    } catch {
      errors.linkedin_url = 'Enter a valid LinkedIn URL.'
    }
  }
  if (TURNSTILE_SITE_KEY && !captchaToken) errors.captcha = 'Complete the verification before applying.'
  return errors
}

function RoleCard({ role, onDetails, onApply }) {
  const skills = publicSkills(role.public_skills)
  const visibleSkills = skills.slice(0, 3)
  return (
    <article className="public-role-card" tabIndex="0" role="button" onClick={onDetails} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onDetails()
      }
    }} aria-label={`View ${role.public_name}`}>
      <div className="public-role-card-heading">
        <div className="public-role-card-icon"><BriefcaseBusiness size={22} /></div>
        <h2>{role.public_name}</h2>
      </div>
      <div className="public-role-meta">
        <span><MapPin size={15} />{role.public_location}</span>
        <span><BriefcaseBusiness size={15} />{role.public_experience}</span>
      </div>
      {skills.length > 0 && <div className="public-role-skills">
        <strong>Skills</strong>
        <div className="public-skill-list" aria-label="Skills">
          {visibleSkills.map(skill => <span key={skill}>{skill}</span>)}
          {skills.length > visibleSkills.length && <span>+{skills.length - visibleSkills.length}</span>}
        </div>
      </div>}
      <div className="public-role-deadline">
        <CalendarDays size={17} />
        <span><strong>Application Deadline</strong>{publicDate(role.application_deadline)}</span>
      </div>
      <div className="public-role-card-actions">
        <button type="button" className="public-primary-button" onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onApply() }}>Apply</button>
      </div>
    </article>
  )
}

function DetailsModal({ role, loading, error, onClose, onApply }) {
  const skills = publicSkills(role?.public_skills)
  return (
    <div className="public-modal-overlay" role="presentation">
      <section className="public-modal-card public-details-modal" role="dialog" aria-modal="true" aria-labelledby="public-role-title">
        <header className="public-modal-header">
          <div className="public-details-heading">
            <div className="public-role-card-icon"><BriefcaseBusiness size={24} /></div>
            <h2 id="public-role-title">{role?.public_name || 'Role details'}</h2>
          </div>
          <button type="button" className="public-icon-button" onClick={onClose} aria-label="Close role details"><X size={20} /></button>
        </header>
        <div className="public-modal-body">
          {loading && <div className="public-centered-state"><Loader2 className="public-spin" size={26} /><span>Loading role details...</span></div>}
          {!loading && error && <div className="public-alert public-alert-error"><AlertCircle size={18} /><span>{error}</span></div>}
          {!loading && role && (
            <>
              <div className="public-detail-meta">
                <div>
                  <MapPin size={19} />
                  <strong>Location</strong>
                  <span>{role.public_location}</span>
                </div>
                <div>
                  <BriefcaseBusiness size={19} />
                  <strong>Experience</strong>
                  <span>{role.public_experience}</span>
                </div>
                {skills.length > 0 && <div className="public-detail-skills">
                  <Star size={19} />
                  <strong>Skills</strong>
                  <div className="public-skill-list">{skills.map(skill => <span key={skill}>{skill}</span>)}</div>
                </div>}
                <div>
                  <CalendarDays size={19} />
                  <strong>Application Deadline</strong>
                  <span>{publicDate(role.application_deadline)}</span>
                </div>
              </div>
              {role.public_jd && <div className="public-jd-block">
                <h3>JD</h3>
                <div><PublicJdContent value={role.public_jd} /></div>
              </div>}
            </>
          )}
        </div>
        <footer className="public-modal-footer public-details-actions">
          {role && !loading && <button type="button" className="public-primary-button" onClick={onApply}>Apply Now</button>}
          <button type="button" className="public-secondary-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  )
}

function LocationFilter({ locations, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setOpen(false)
        rootRef.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const allSelected = locations.length > 0 && selected.length === locations.length
  const summary = !selected.length || allSelected
    ? 'All Locations'
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} +${selected.length - 1}`
  const toggle = location => onChange(selected.includes(location)
    ? selected.filter(value => value !== location)
    : [...selected, location])

  return (
    <div className="public-location-filter" ref={rootRef}>
      <button type="button" className="public-location-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <MapPin size={18} /><span>{summary}</span><ChevronDown size={16} className={open ? 'is-open' : ''} />
      </button>
      {open && <div className="public-location-menu" role="listbox" aria-label="Filter by locations" aria-multiselectable="true">
        <div className="public-location-actions">
          <button type="button" onClick={() => onChange(locations)} disabled={allSelected}>Select All</button>
          <button type="button" onClick={() => onChange([])} disabled={!selected.length}>Clear</button>
        </div>
        <div className="public-location-options">
          {locations.map(location => <label key={location}><input type="checkbox" checked={selected.includes(location)} onChange={() => toggle(location)} /><span>{location}</span></label>)}
        </div>
      </div>}
    </div>
  )
}

function ApplicationModal({ role, onClose }) {
  const [stage, setStage] = useState('upload')
  const [resume, setResume] = useState(null)
  const [applicant, setApplicant] = useState(EMPTY_APPLICANT)
  const [skillInput, setSkillInput] = useState('')
  const [parseMeta, setParseMeta] = useState({ formToken: '', formStartedAt: '' })
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [website, setWebsite] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaRevision, setCaptchaRevision] = useState(0)
  const parseRequestRef = useRef(null)
  const parseBusyRef = useRef(false)
  const submitBusyRef = useRef(false)
  const fileInputRef = useRef(null)

  useEffect(() => () => parseRequestRef.current?.abort(), [])

  const setField = (key, value) => {
    setApplicant(current => ({ ...current, [key]: value }))
    setErrors(current => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const runParse = async (file, { replacing = false } = {}) => {
    if (parseBusyRef.current || submitBusyRef.current) return
    parseBusyRef.current = true
    setNotice('')
    setCaptchaToken('')
    setCaptchaRevision(value => value + 1)
    const fileError = await validatePublicCv(file).catch(() => 'The selected PDF could not be read.')
    if (fileError) {
      setErrors(current => ({ ...current, resume: fileError }))
      parseBusyRef.current = false
      return
    }
    parseRequestRef.current?.abort()
    const controller = new AbortController()
    parseRequestRef.current = controller
    setParsing(true)
    setErrors({})
    setParseMeta({ formToken: '', formStartedAt: '' })
    try {
      const parsed = await parsePublicResume(file, { signal: controller.signal })
      if (!parsed.formToken || !parsed.formStartedAt) throw new Error('The application session could not be initialized. Please parse the resume again.')
      setResume(file)
      const nextApplicant = parsedApplicant(parsed.data)
      setApplicant(current => replacing ? {
        ...nextApplicant,
        notice_period: current.notice_period,
        open_to_relocate: current.open_to_relocate,
        comments: current.comments,
      } : nextApplicant)
      setParseMeta({ formToken: parsed.formToken, formStartedAt: parsed.formStartedAt })
      setStage('review')
      setNotice(replacing ? 'Replacement CV parsed. Please review all details again.' : 'Resume parsed. Review and complete every field before applying.')
    } catch (error) {
      if (error?.name !== 'AbortError') setErrors(current => ({ ...current, resume: error.message || 'Resume parsing failed. You can try another PDF.' }))
    } finally {
      if (parseRequestRef.current === controller) parseRequestRef.current = null
      parseBusyRef.current = false
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const addSkill = () => {
    const value = clean(skillInput)
    if (!value) return
    setField('skills', publicSkills([...applicant.skills, value]))
    setSkillInput('')
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitBusyRef.current || parseBusyRef.current) return
    const nextErrors = validateApplicant(applicant, resume, captchaToken)
    if (!parseMeta.formToken || !parseMeta.formStartedAt) nextErrors.resume = 'Parse the selected resume again before applying.'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      setNotice('Please complete every required field.')
      return
    }
    submitBusyRef.current = true
    setSubmitting(true)
    setErrors({})
    setNotice('')
    try {
      const response = await submitPublicApplication({
        roleSlug: role.slug,
        resume,
        applicant: { ...applicant, skills: publicSkills(applicant.skills) },
        website,
        formToken: parseMeta.formToken,
        formStartedAt: parseMeta.formStartedAt,
        captchaToken,
      })
      window.dispatchEvent(new Event('ats:applied-candidates-updated'))
      try {
        window.localStorage.setItem('ats:sidebar-counts-refresh', String(Date.now()))
      } catch {
        // A successful application must not be reported as failed when browser storage is unavailable.
      }
      setNotice(response.message || 'Your application has been submitted successfully.')
      setStage('success')
    } catch (error) {
      const duplicate = error instanceof PublicApiError && (error.status === 409 || /duplicate|already/i.test(error.message))
      const fieldErrors = error instanceof PublicApiError && error.payload?.errors && typeof error.payload.errors === 'object' ? error.payload.errors : {}
      setErrors({ ...fieldErrors, form: duplicate ? 'An active application using this email or mobile already exists for this role.' : error.message || 'Your application could not be submitted.' })
      setCaptchaToken('')
      setCaptchaRevision(value => value + 1)
    } finally {
      submitBusyRef.current = false
      setSubmitting(false)
    }
  }

  const turnstileToken = useCallback(token => {
    setCaptchaToken(token)
    setErrors(current => {
      if (!current.captcha) return current
      const next = { ...current }
      delete next.captcha
      return next
    })
  }, [])
  const turnstileError = useCallback(message => setErrors(current => ({ ...current, captcha: message })), [])

  return (
    <div className="public-modal-overlay" role="presentation">
      <section className="public-modal-card public-application-modal" role="dialog" aria-modal="true" aria-labelledby="public-application-title">
        <header className="public-modal-header">
          <div>
            <span className="public-eyebrow">Apply for</span>
            <h2 id="public-application-title">{role.public_name}</h2>
            <div className="public-application-role-meta"><span><MapPin size={13} />{role.public_location}</span><span><BriefcaseBusiness size={13} />{role.public_experience}</span></div>
          </div>
          <button type="button" className="public-icon-button" onClick={onClose} disabled={submitting || parsing} aria-label="Close application"><X size={20} /></button>
        </header>
        {stage !== 'success' && (
          <div className="public-stepper" aria-label="Application progress">
            <span className={stage === 'upload' ? 'is-active' : 'is-complete'}><b>1</b> Upload CV</span>
            <i />
            <span className={stage === 'review' ? 'is-active' : ''}><b>2</b> Review Details</span>
          </div>
        )}
        {stage === 'upload' && (
          <div className="public-modal-body public-upload-body">
            <FileText size={40} />
            <h3>Upload your CV</h3>
            <p>Upload one PDF up to exactly 1 MB. Your resume will be parsed so you can review every detail before applying.</p>
            <label className={`public-upload-zone${errors.resume ? ' is-error' : ''}`}>
              <Upload size={21} />
              <span>{parsing ? 'Parsing resume...' : 'Choose PDF resume'}</span>
              <small>PDF only · maximum 1 MB</small>
              <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" disabled={parsing} onChange={event => {
                const file = event.target.files?.[0]
                if (file) runParse(file)
                else event.target.value = ''
              }} />
            </label>
            {parsing && <div className="public-inline-loading"><Loader2 className="public-spin" size={17} />Reading your resume securely...</div>}
            {errors.resume && <div className="public-field-error" role="alert">{errors.resume}</div>}
          </div>
        )}
        {stage === 'review' && (
          <form onSubmit={submit} noValidate>
            <div className="public-modal-body public-review-body">
              {notice && <div className="public-alert public-alert-info"><CheckCircle2 size={18} /><span>{notice}</span></div>}
              {errors.form && <div className="public-alert public-alert-error" role="alert"><AlertCircle size={18} /><span>{errors.form}</span></div>}
              <div className="public-review-role-card"><div><span>Selected Role</span><strong>{role.public_name}</strong></div><div><span>Location &amp; Experience</span><strong>{role.public_location} · {role.public_experience}</strong></div><div><span>Application Deadline</span><strong>{publicDate(role.application_deadline)}</strong></div></div>
              <div className="public-resume-summary">
                <div><FileText size={20} /><span><strong>Resume</strong><small>{resume?.name}</small></span></div>
                <label className="public-text-button">
                  {parsing ? 'Parsing...' : 'Replace CV'}
                  <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" disabled={parsing || submitting} onChange={event => {
                    const file = event.target.files?.[0]
                    if (file) runParse(file, { replacing: true })
                  }} />
                </label>
              </div>
              {errors.resume && <div className="public-field-error">{errors.resume}</div>}
              <div className="public-application-grid">
                <PublicField label="Candidate Name" error={errors.full_name}><input value={applicant.full_name} onChange={event => setField('full_name', event.target.value)} /></PublicField>
                <PublicField label="Email" error={errors.email}><input type="email" value={applicant.email} onChange={event => setField('email', event.target.value)} /></PublicField>
                <PublicField label="Mobile" error={errors.mobile_number}><input type="tel" value={applicant.mobile_number} onChange={event => setField('mobile_number', event.target.value)} /></PublicField>
                <PublicField label="Current Designation" error={errors.current_designation}><input value={applicant.current_designation} onChange={event => setField('current_designation', event.target.value)} /></PublicField>
                <PublicField label="Current Organization" error={errors.current_organisation}><input value={applicant.current_organisation} onChange={event => setField('current_organisation', event.target.value)} /></PublicField>
                <PublicField label="Total Experience (years)" error={errors.experience_years}><input className="public-number-input" type="number" inputMode="decimal" min="0" step="0.1" value={applicant.experience_years} onWheel={releaseNumberInputOnWheel} onKeyDown={event => { if (['e', 'E', '+', '-'].includes(event.key)) event.preventDefault() }} onChange={event => setField('experience_years', event.target.value)} /></PublicField>
                <PublicField label="Current Location" error={errors.location}><input value={applicant.location} onChange={event => setField('location', event.target.value)} /></PublicField>
                <PublicField label="Notice Period (days)" error={errors.notice_period}><input className="public-number-input" type="number" inputMode="numeric" min="0" step="1" value={applicant.notice_period} onWheel={releaseNumberInputOnWheel} onKeyDown={event => { if (['e', 'E', '+', '-', '.'].includes(event.key)) event.preventDefault() }} onChange={event => setField('notice_period', event.target.value)} /></PublicField>
                <PublicField label="Current CTC" error={errors.current_salary} adornment="₹" endAdornment="LPA"><input type="text" inputMode="decimal" value={applicant.current_salary} onChange={event => setField('current_salary', event.target.value)} /></PublicField>
                <PublicField label="LinkedIn" required={false} error={errors.linkedin_url}><input type="url" placeholder="https://www.linkedin.com/in/..." value={applicant.linkedin_url} onChange={event => setField('linkedin_url', event.target.value)} /></PublicField>
                <PublicField label="Open to Relocate" error={errors.open_to_relocate}>
                  <select value={applicant.open_to_relocate} onChange={event => setField('open_to_relocate', event.target.value)}>
                    <option value="">Select</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                    <option value="NA">NA</option>
                  </select>
                </PublicField>
                <PublicField label="Skills" error={errors.skills} full>
                  <div className="public-skill-editor">
                    <div className="public-skill-list">{applicant.skills.map(skill => <span key={skill}>{skill}<button type="button" onClick={() => setField('skills', applicant.skills.filter(item => item !== skill))} aria-label={`Remove ${skill}`}><X size={12} /></button></span>)}</div>
                    <div><input value={skillInput} onChange={event => setSkillInput(event.target.value)} onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addSkill() }
                    }} placeholder="Type a skill" /><button type="button" onClick={addSkill}>Add</button></div>
                  </div>
                </PublicField>
                <PublicField label="Comments" required={false} error={errors.comments} full><textarea rows="4" value={applicant.comments} onChange={event => setField('comments', event.target.value)} /></PublicField>
              </div>
              <div className="public-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex="-1" autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} /></label></div>
              <TurnstileWidget key={captchaRevision} siteKey={TURNSTILE_SITE_KEY} onTokenChange={turnstileToken} onError={turnstileError} />
              {errors.captcha && <div className="public-field-error">{errors.captcha}</div>}
              <p className="public-privacy-note">Your details and CV are submitted securely to FyndBridge for recruitment review. They are not added to the ATS Candidates workflow until an authorised consultant reviews and accepts the application.</p>
            </div>
            <footer className="public-modal-footer">
              <button type="button" className="public-secondary-button" onClick={onClose} disabled={submitting || parsing}>Cancel</button>
              <button type="submit" className="public-primary-button" disabled={submitting || parsing}>{submitting ? <><Loader2 className="public-spin" size={16} />Saving...</> : 'Save & Apply'}</button>
            </footer>
          </form>
        )}
        {stage === 'success' && (
          <div className="public-modal-body public-success-state">
            <CheckCircle2 size={54} />
            <h3>Application submitted</h3>
            <p>{notice || 'Your application has been submitted successfully.'}</p>
            <button type="button" className="public-primary-button" onClick={onClose}>Close</button>
          </div>
        )}
        {stage === 'upload' && <footer className="public-modal-footer"><button type="button" className="public-secondary-button" onClick={onClose} disabled={parsing}>Cancel</button></footer>}
      </section>
    </div>
  )
}

function PublicField({ label, error, full = false, required = true, adornment = '', endAdornment = '', children }) {
  return (
    <label className={`public-form-field${full ? ' is-full' : ''}${error ? ' is-error' : ''}`}>
      <span>{label} {required ? <b>*</b> : <em>(Optional)</em>}</span>
      <div className={adornment || endAdornment ? 'public-adorned-input' : ''}>
        {adornment && <i>{adornment}</i>}
        {children}
        {endAdornment && <i>{endAdornment}</i>}
      </div>
      {error && <small role="alert">{error}</small>}
    </label>
  )
}

export default function PublicRolesPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [query, setQuery] = useState('')
  const [locationFilters, setLocationFilters] = useState([])
  const [detailRole, setDetailRole] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [applicationRole, setApplicationRole] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchPublicRoles({ signal: controller.signal })
      .then(setRoles)
      .catch(error => { if (error?.name !== 'AbortError') setListError(error.message || 'Open roles could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    Promise.resolve().then(async () => {
      setDetailRole(null)
      setDetailError('')
      setDetailLoading(true)
      try {
        const role = await fetchPublicRole(slug, { signal: controller.signal })
        setDetailRole(role)
      } catch (error) {
        if (error?.name !== 'AbortError') setDetailError(error.message || 'This role is not available.')
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false)
      }
    })
    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    if (!detailRole && !detailLoading && !applicationRole) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [applicationRole, detailLoading, detailRole])

  const locations = useMemo(() => [...new Set(roles.map(role => clean(role.public_location)).filter(Boolean))].sort(), [roles])
  const filteredRoles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return roles.filter(role => {
      const matchesSearch = !needle || `${role.public_name} ${publicSkills(role.public_skills).join(' ')}`.toLowerCase().includes(needle)
      const matchesLocation = !locationFilters.length || locationFilters.length === locations.length || locationFilters.includes(role.public_location)
      return matchesSearch && matchesLocation
    })
  }, [locationFilters, locations.length, query, roles])

  const openDetails = role => navigate(`/open-roles/${encodeURIComponent(role.slug)}`)
  const closeDetails = () => navigate('/open-roles')
  const openApplication = role => {
    setApplicationRole(role)
    if (slug) navigate('/open-roles', { replace: true })
  }

  return (
    <div className="public-roles-page">
      <header className="public-roles-header">
        <picture>
          <source srcSet="/assets/fyndbridge-official-logo-380.webp 380w, /assets/fyndbridge-official-logo.webp 543w" sizes="(max-width: 620px) 180px, 290px" type="image/webp" />
          <img src="/assets/fyndbridge-official-logo.png" alt="FYNDBRIDGE" width="380" height="63" decoding="async" />
        </picture>
        <a className="public-back-home" href="https://fyndbridge.in/">Back to Home</a>
      </header>
      <section className="public-roles-hero">
        <h1>Open Roles</h1>
      </section>
      <section className="public-role-controls" aria-label="Filter open roles">
        <label className="public-search-control"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by role, skill or keyword" aria-label="Search by role or skill" /></label>
        <LocationFilter locations={locations} selected={locationFilters} onChange={setLocationFilters} />
        <button className="public-clear-filters" type="button" onClick={() => { setQuery(''); setLocationFilters([]) }} disabled={!query && !locationFilters.length}><RotateCcw size={16} />Clear Filters</button>
      </section>
      {loading && <div className="public-page-state"><Loader2 className="public-spin" size={28} /><h2>Loading open roles</h2><p>Please wait while we find current opportunities.</p></div>}
      {!loading && listError && <div className="public-page-state is-error"><AlertCircle size={30} /><h2>Roles could not be loaded</h2><p>{listError}</p><button type="button" className="public-secondary-button" onClick={() => window.location.reload()}>Try again</button></div>}
      {!loading && !listError && roles.length === 0 && <div className="public-page-state"><BriefcaseBusiness size={34} /><h2>No open roles right now</h2><p>Please check back soon for new opportunities.</p></div>}
      {!loading && !listError && roles.length > 0 && filteredRoles.length === 0 && <div className="public-page-state"><Search size={32} /><h2>No roles match your filters</h2><p>Try a different role, skill, or location.</p><button type="button" className="public-secondary-button" onClick={() => { setQuery(''); setLocationFilters([]) }}>Clear filters</button></div>}
      {!loading && !listError && filteredRoles.length > 0 && <section className="public-role-grid" aria-live="polite">{filteredRoles.map(role => <RoleCard key={role.slug} role={role} onDetails={() => openDetails(role)} onApply={() => openApplication(role)} />)}</section>}
      {slug && <DetailsModal role={detailRole} loading={detailLoading} error={detailError} onClose={closeDetails} onApply={() => detailRole && openApplication(detailRole)} />}
      {applicationRole && <ApplicationModal key={applicationRole.slug} role={applicationRole} onClose={() => setApplicationRole(null)} />}
    </div>
  )
}
