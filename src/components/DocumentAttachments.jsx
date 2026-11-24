import { FileText, Link2, Loader2, Trash2 } from 'lucide-react'
import { formatFileSize, isExternalAttachment, pendingFileKey } from '../utils/documentAttachments'
import { useCvBranding } from '../hooks/useCvBranding'
import CvBrandingGlyph from './CvBrandingGlyph'

export function AttachmentList({
  saved = [],
  pending = [],
  pendingAttachments = [],
  removedPaths = [],
  onOpen,
  onRemoveSaved,
  onRemovePending,
  onRemovePendingAttachment,
  openingKey = '',
  keyPrefix = 'attachment',
  disabled = false,
  showExternalLinkIcon = false
}) {
  const removed = new Set(removedPaths)
  const visibleSaved = saved.filter(item => item?.path && !removed.has(item.path))
  if (!visibleSaved.length && !pending.length && !pendingAttachments.length) return null

  return (
    <div className="document-attachment-list" aria-label="Selected attachments">
      {visibleSaved.map((attachment, index) => {
        const itemKey = `${keyPrefix}-saved-${attachment.path}`
        const isOpening = openingKey === itemKey
        const isExternal = showExternalLinkIcon && isExternalAttachment(attachment)
        return (
          <div className="document-attachment-item" key={attachment.path}>
            <button className="document-attachment-main" type="button" title={attachment.name} onClick={() => onOpen?.(itemKey, attachment)} disabled={disabled || !onOpen}>
              {isOpening ? <Loader2 size={15} className="spin" /> : isExternal ? <Link2 size={15} /> : <FileText size={15} />}
              <span className="document-attachment-name">{attachment.name || `Document ${index + 1}`}</span>
              {formatFileSize(attachment.size) && <span className="document-attachment-size">{formatFileSize(attachment.size)}</span>}
            </button>
            {onRemoveSaved && (
              <button className="document-attachment-remove" type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveSaved(attachment)} disabled={disabled}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )
      })}
      {pending.map((file, index) => (
        <div className="document-attachment-item is-pending" key={pendingFileKey(file, index)}>
          <div className="document-attachment-main">
            <FileText size={15} />
            <span className="document-attachment-name">{file.name}</span>
            {formatFileSize(file.size) && <span className="document-attachment-size">{formatFileSize(file.size)}</span>}
          </div>
          {onRemovePending && (
            <button className="document-attachment-remove" type="button" title={`Remove ${file.name}`} aria-label={`Remove ${file.name}`} onClick={() => onRemovePending(index)} disabled={disabled}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {pendingAttachments.map((attachment, index) => (
        <div className="document-attachment-item is-pending" key={attachment.path}>
          <div className="document-attachment-main" title={attachment.name}>
            {showExternalLinkIcon && isExternalAttachment(attachment) ? <Link2 size={15} /> : <FileText size={15} />}
            <span className="document-attachment-name">{attachment.name || `Document ${index + 1}`}</span>
          </div>
          {onRemovePendingAttachment && (
            <button className="document-attachment-remove" type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} onClick={() => onRemovePendingAttachment(index)} disabled={disabled}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function DocumentIcon({ attachment, index, onOpen, openingKey, keyPrefix, showExternalLinkIcon, brandingContext }) {
  const itemKey = `${keyPrefix}-${attachment.path}`
  const isExternal = showExternalLinkIcon && isExternalAttachment(attachment)
  const branding = useCvBranding(brandingContext, attachment.path)
  const name = attachment.name || `document ${index + 1}`
  const label = branding.failed ? `Retry CV branding for ${name}` : branding.blocked ? `Branding ${name}` : `Open ${name}`
  return <a
    href={branding.failed ? '#' : branding.blocked ? undefined : isExternal ? attachment.path : '#'}
    target={!branding.blocked && isExternal ? '_blank' : undefined}
    rel={isExternal ? 'noopener noreferrer' : undefined}
    role="link"
    className={`cv-table-link document-icon-link${branding.failed ? ' cv-branding-retry' : ''}`}
    title={branding.failed ? 'CV branding could not finish. Click to retry.' : branding.blocked ? 'Branding CV. Opening is unavailable until it finishes.' : name}
    aria-label={label}
    aria-disabled={branding.blocked && !branding.failed ? true : undefined}
    aria-busy={branding.blocked && !branding.failed ? true : undefined}
    data-cv-branding-status={branding.status}
    onClick={event => {
      event.preventDefault(); event.stopPropagation()
      if (branding.failed) { branding.retry(); return }
      if (branding.blocked) return
      onOpen?.(itemKey, attachment)
    }}
  >
    {brandingContext ? <CvBrandingGlyph pending={branding.blocked && !branding.failed} failed={branding.failed} opening={openingKey === itemKey} external={isExternal ? <Link2 size={15} /> : null} />
      : openingKey === itemKey ? <Loader2 size={15} className="spin" /> : isExternal ? <Link2 size={15} /> : <FileText size={15} />}
  </a>
}

export function DocumentIconGroup({ attachments = [], onOpen, openingKey = '', keyPrefix = 'document', empty = '-', showExternalLinkIcon = false, brandingContext }) {
  if (!attachments.length) return empty
  return (
    <span className="document-icon-group">
      {attachments.map((attachment, index) => <DocumentIcon key={attachment.path} {...{ attachment, index, onOpen, openingKey, keyPrefix, showExternalLinkIcon, brandingContext }} />)}
    </span>
  )
}
