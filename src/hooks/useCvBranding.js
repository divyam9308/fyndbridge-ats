import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { brandedCvItem, getBrandingStatus, subscribeToBranding, retryBranding } from '../services/cvBrandingStatus'

export function useCvBranding(context, path) {
  const type = context?.type, recordId = context?.recordId
  const item = useMemo(() => brandedCvItem({ type, recordId }, path), [type, recordId, path])
  const subscribe = useCallback(listener => subscribeToBranding(item, listener), [item])
  const snapshot = useCallback(() => getBrandingStatus(item), [item])
  const status = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { status, blocked: status !== 'ready', failed: ['failed', 'unavailable', 'cancelled'].includes(status), retry: () => retryBranding(item) }
}
