import { FileText, Loader2, TriangleAlert } from 'lucide-react'
import './CvBranding.css'

export default function CvBrandingGlyph({ pending = false, failed = false, opening = false, external = null }) {
  return <span className={`cv-branding-glyph${pending ? ' is-pending' : ''}`} aria-hidden="true">
    <span className="cv-branding-document">{external || <FileText size={15} />}</span>
    {(pending || opening) && <Loader2 size={24} className="spin cv-branding-spinner" />}
    {failed && <TriangleAlert size={13} className="cv-branding-error" />}
  </span>
}
