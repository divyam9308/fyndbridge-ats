import { FileText, Link2, Loader2, Trash2 } from 'lucide-react'
import { formatFileSize, isExternalAttachment, pendingFileKey } from '../utils/documentAttachments'

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

export function DocumentIconGroup({ attachments = [], onOpen, openingKey = '', keyPrefix = 'document', empty = '-', showExternalLinkIcon = false }) {
  if (!attachments.length) return empty
  return (
    <span className="document-icon-group">
      {attachments.map((attachment, index) => {
        const itemKey = `${keyPrefix}-${attachment.path}`
        const isExternal = showExternalLinkIcon && isExternalAttachment(attachment)
        return (
          <a
            href={isExternal ? attachment.path : '#'}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            className="cv-table-link document-icon-link"
            title={attachment.name || `Document ${index + 1}`}
            aria-label={`Open ${attachment.name || `document ${index + 1}`}`}
            key={attachment.path}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onOpen?.(itemKey, attachment)
            }}
          >
            {openingKey === itemKey ? <Loader2 size={15} className="spin" /> : isExternal ? <Link2 size={15} /> : <FileText size={15} />}
          </a>
        )
      })}
    </span>
  )
}
