import { useEffect, useRef, useState } from 'react'
import { Pencil, Sparkles } from 'lucide-react'
import { crmRequest } from '../services/crmApi'

const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}
export const summaryPlainText = summary => String(summary?.text || '').replace(/\*\*/g, '').replace(/^\s*[-*•]\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim()

function inlineText(text) {
  // A deliberately small formatting vocabulary: bold and HTTPS source links.
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/)
    if (link && safeUrl(link[2])) return <a key={index} href={safeUrl(link[2])} target="_blank" rel="noopener noreferrer">{link[1]}</a>
    return part
  })
}

export function CrmSummaryContent({ summary }) {
  if (!summary?.text) return <p className="sub-text">No organisation summary yet.</p>
  const lines = summary.text.split(/\n/).map(line => line.trim()).filter(Boolean)
  const sources = (summary.sources || []).filter(source => safeUrl(source.url))
  return <div className="crm-summary-content">
    <ul>{lines.map((line, index) => <li key={index}>{inlineText(line.replace(/^(?:[-*•]|\d+[.)])\s+/, ''))}</li>)}</ul>
    {sources.length > 0 && <div className="crm-summary-sources"><strong>Sources</strong><ul>{sources.map((source, index) => <li key={`${source.url}:${index}`}><a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title || new URL(source.url).hostname} ↗</a></li>)}</ul></div>}
    {summary.search_suggestions && <iframe className="crm-summary-search" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'"><base target="_blank">${summary.search_suggestions}`} />}
  </div>
}

export default function CrmOrganisationSummary({ name, sector, value, onChange, onBusyChange, disabled }) {
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)
  useEffect(() => {
    request.current?.abort(); request.current = null; setGenerating(false); setError(''); onBusyChange(false)
    return () => { request.current?.abort(); request.current = null; onBusyChange(false) }
  }, [name, sector, onBusyChange])
  const generate = async () => {
    if (request.current || disabled || !name.trim()) return
    const controller = new AbortController()
    request.current = controller; setGenerating(true); onBusyChange(true); setError('')
    try {
      const { data } = await crmRequest('/organisation-summary', { method: 'POST', body: JSON.stringify({ organisation_name: name, sector: sector || '' }), signal: controller.signal })
      if (!controller.signal.aborted) { onChange(data); setEditing(false) }
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
    finally { if (request.current === controller) { request.current = null; setGenerating(false); onBusyChange(false) } }
  }
  return <section className="crm-summary-field" aria-label="About organisation">
    <div className="crm-summary-heading"><label className="form-label" htmlFor={editing ? 'crm-organisation-summary' : undefined}>About Organisation</label><div>
      <button type="button" className="btn-secondary crm-summary-edit" disabled={disabled || generating} onClick={() => setEditing(current => !current)}><Pencil size={12} />{editing ? 'Done' : 'Edit'}</button>
      <button type="button" className="btn-secondary crm-summary-generate" disabled={disabled || generating || !name.trim()} onClick={generate} aria-busy={generating}><Sparkles size={14} />{generating ? 'Searching online...' : value?.text ? 'Regenerate AI Summary' : 'Generate AI Summary'}</button>
    </div></div>
    {editing ? <textarea id="crm-organisation-summary" className="form-control crm-summary-scroll crm-summary-input" value={value?.text || ''} maxLength={6000} disabled={disabled || generating} placeholder={'- **Business:** What the organisation does\n- **Products & services:** Key offerings'} onChange={event => onChange({ ...value, text: event.target.value, sources: value?.sources || [] })} /> : <div className="crm-summary-scroll" tabIndex={0} role="region" aria-label="Organisation summary" aria-live="polite">
      {value?.text ? <CrmSummaryContent summary={value} /> : <p className="sub-text">Generate a company overview from the web, or choose Edit to write one.</p>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
