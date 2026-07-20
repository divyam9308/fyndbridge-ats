import { createElement, Fragment, useState } from 'react'
import {
  cancelInvoice as cancelInvoiceRequest,
  deleteInvoicePdfVersion
} from '../services/invoiceApi'
import { isValidStoragePath, openProtectedDocumentPath } from '../services/apiClient'
import {
  EditInvoiceModal,
  InvoiceActionControls,
  InvoiceActionDialog,
  InvoiceDocumentControl
} from '../components/InvoiceRowControls'

export function useInvoiceRowControls({
  entities = [],
  onRefresh,
  onCancelled,
  onError,
  onToast
}) {
  const [editing, setEditing] = useState(null)
  const [opening, setOpening] = useState('')
  const [deletingVersion, setDeletingVersion] = useState('')
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [pendingAction, setPendingAction] = useState(null)

  const clearError = () => onError?.('')
  const openInvoice = async invoice => {
    const path = invoice.storage_path || invoice.pdf_storage_path
    if (!isValidStoragePath(path)) return onError?.('Stored invoice PDF is missing.')
    setOpening(invoice.id)
    try {
      await openProtectedDocumentPath('invoice', path, {
        missingMessage: 'Invoice PDF is missing or needs to be reuploaded',
        notFoundMessage: 'Invoice PDF not found.'
      })
    } finally { setOpening('') }
  }
  const deleteVersion = async (invoice, version, versionNumber) => {
    if (deletingVersion) return
    if (!window.confirm(`Delete PDF version v${versionNumber} for ${invoice.invoice_number}?`)) return
    setDeletingVersion(version.id); clearError()
    try {
      await deleteInvoicePdfVersion(version.id)
      onToast?.(`PDF version v${versionNumber} was deleted. The invoice remains available.`)
      await onRefresh?.()
    } catch (err) { onError?.(err.message) } finally { setDeletingVersion('') }
  }
  const openAction = (invoice, entity) => {
    setActionError('')
    setAction({ invoice, entity })
  }
  const closeAction = () => {
    if (!pendingAction) {
      setAction(null)
      setActionError('')
    }
  }
  const confirmAction = async () => {
    if (!action || pendingAction) return
    const pending = { id: action.invoice.id }
    setPendingAction(pending); setActionError(''); clearError()
    try {
      const result = await cancelInvoiceRequest(action.entity.id, action.invoice.id, action.invoice.invoice_type)
      if (onCancelled) await onCancelled(result, action.invoice)
      else await onRefresh?.()
      onToast?.(`${action.invoice.invoice_number} was cancelled. Its number remains consumed.`)
      setAction(null)
    } catch (err) { setActionError(err.message) } finally { setPendingAction(null) }
  }
  const renderInvoiceControl = invoice => createElement(InvoiceDocumentControl, {
    invoice,
    opening,
    deletingVersion,
    onOpen: openInvoice,
    onDelete: deleteVersion
  })
  const renderActionControls = (invoice, entity) => createElement(InvoiceActionControls, {
    invoice,
    entity,
    pendingAction,
    onEdit: (selectedInvoice, selectedEntity) => setEditing({ invoice: selectedInvoice, entity: selectedEntity }),
    onCancel: openAction
  })
  const dialogs = createElement(
    Fragment,
    null,
    editing && createElement(EditInvoiceModal, {
      invoice: editing.invoice,
      entity: editing.entity,
      entities,
      onClose: () => setEditing(null),
      onSaved: onRefresh
    }),
    action && createElement(InvoiceActionDialog, {
      action,
      busy: Boolean(pendingAction),
      error: actionError,
      onClose: closeAction,
      onConfirm: confirmAction
    })
  )

  return {
    dialogOpen: Boolean(editing || action),
    pendingAction,
    renderInvoiceControl,
    renderActionControls,
    dialogs
  }
}
