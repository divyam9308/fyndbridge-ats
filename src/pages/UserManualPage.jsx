import { useEffect, useRef, useState } from 'react'
import { BookOpenText, Upload, AlertTriangle } from 'lucide-react'
import { useAdminAccess } from '../hooks/useAdminAccess'
import { fetchUserManual, uploadUserManual } from '../services/userManualApi'
import './UserManualPage.css'

function ManualSection({ section }) {
  if (!section?.content) return null
  if (section.type === 'title') return <h1 className="user-manual-title">{section.content}</h1>
  if (section.type === 'heading') return <h2 className="user-manual-heading">{section.content}</h2>
  if (section.type === 'subheading') return <h3 className="user-manual-subheading">{section.content}</h3>
  if (section.type === 'bullet') {
    return <div className="user-manual-bullet"><span>•</span><p>{section.content}</p></div>
  }
  return <p className="user-manual-paragraph">{section.content}</p>
}

export default function UserManualPage() {
  const { isSuperAdmin } = useAdminAccess({ loadPermissions: false })
  const inputRef = useRef(null)
  const [manual, setManual] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data } = await fetchUserManual()
        if (active) setManual(data || null)
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const handleUpload = async (file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('Only PDF files are accepted for the user manual.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const { data } = await uploadUserManual(file)
      setManual(data || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const hasSections = Array.isArray(manual?.sections) && manual.sections.length > 0

  return (
    <div className="user-manual-page">
      <section className="user-manual-hero">
        <div>
          <span className="user-manual-kicker"><BookOpenText size={15} />User Manual</span>
          <h1>Reference guide for the ATS</h1>
          <p>{manual?.fileName ? `Showing ${manual.fileName}` : 'Upload a PDF manual and it will be rendered here as a readable, scrollable page.'}</p>
        </div>
        {isSuperAdmin && (
          <div className="user-manual-actions">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="user-manual-file-input"
              onChange={event => handleUpload(event.target.files?.[0] || null)}
            />
            <button type="button" className="user-manual-upload-btn" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Upload size={16} />
              {uploading ? 'Saving...' : manual?.path ? 'Add User Manual' : 'Add User Manual'}
            </button>
          </div>
        )}
      </section>

      {error && <div className="user-manual-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}

      <section className="user-manual-viewer">
        {loading ? <div className="user-manual-empty">Loading user manual...</div> : null}
        {!loading && !hasSections ? <div className="user-manual-empty">{isSuperAdmin ? 'Upload a user manual PDF to populate this page.' : 'User manual has not been uploaded yet.'}</div> : null}
        {hasSections ? (
          <div className="user-manual-document">
            {manual.sections.map((section, index) => <ManualSection key={`${section.type}-${index}`} section={section} />)}
          </div>
        ) : null}
      </section>
    </div>
  )
}
