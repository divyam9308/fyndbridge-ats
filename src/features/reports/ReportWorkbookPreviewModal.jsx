import { useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, X } from 'lucide-react'

function cellStyle(style = {}) {
  return {
    backgroundColor: style.backgroundColor || '#fff',
    color: style.color || '#18243a',
    fontFamily: style.fontFamily || 'Arial, sans-serif',
    fontSize: style.fontSize || 10,
    fontWeight: style.fontWeight || 400,
    fontStyle: style.fontStyle || 'normal',
    textAlign: style.textAlign || 'left',
    verticalAlign: style.verticalAlign || 'middle',
    whiteSpace: style.whiteSpace || 'normal',
    borderColor: style.borderColor || '#d7dfea'
  }
}

export function ReportWorkbookPreviewModal({ exportData, onCancel, onDownload }) {
  const sheets = useMemo(
    () => (Array.isArray(exportData?.preview?.sheets) ? exportData.preview.sheets : []),
    [exportData]
  )
  const [activeSheetName, setActiveSheetName] = useState(sheets[0]?.name || '')
  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) || sheets[0]

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onCancel])

  return (
    <div
      className="report-modal-backdrop report-workbook-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="report-modal report-workbook-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-workbook-preview-title"
      >
        <header className="report-workbook-preview-header">
          <div className="report-workbook-preview-heading">
            <span className="report-workbook-preview-icon" aria-hidden="true"><FileSpreadsheet size={22} /></span>
            <div>
              <h2 id="report-workbook-preview-title">Excel Report Preview</h2>
              <p>{exportData?.fileName || exportData?.preview?.workbookName || 'Consultant report.xlsx'}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel export and close preview"><X size={18} /></button>
        </header>

        <div className="report-workbook-preview-status" role="status">
          <span>No file has been downloaded yet.</span>
          <span>Review the workbook below, then choose Download Excel or Cancel.</span>
        </div>

        <div className="report-workbook-preview-canvas">
          {activeSheet ? (
            <table className="report-workbook-preview-grid" aria-label={`${activeSheet.name} worksheet preview`}>
              <colgroup>
                <col className="report-workbook-row-number-column" />
                {(activeSheet.columnWidths || []).map((width, index) => (
                  <col key={`${activeSheet.name}-column-${index}`} style={{ width: `${width}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="report-workbook-corner" aria-hidden="true" />
                  {(activeSheet.columnLabels || []).map((label) => <th key={label} scope="col">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(activeSheet.rows || []).map((row) => (
                  <tr key={`${activeSheet.name}-row-${row.rowNumber}`} style={{ height: `${Math.max(24, Math.round((row.height || 20) * 1.15))}px` }}>
                    <th scope="row">{row.rowNumber}</th>
                    {(row.cells || []).map((cell) => cell.hidden ? null : (
                      <td
                        key={cell.key}
                        colSpan={cell.colSpan || 1}
                        rowSpan={cell.rowSpan || 1}
                        style={cellStyle(cell.style)}
                        title={cell.text || undefined}
                      >
                        {cell.text || '\u00a0'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="report-empty-state">Workbook preview is unavailable.</div>}
        </div>

        <div className="report-workbook-sheet-tabs" role="tablist" aria-label="Workbook sheets">
          {sheets.map((sheet) => (
            <button
              className={sheet.name === activeSheet?.name ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={sheet.name === activeSheet?.name}
              key={sheet.name}
              onClick={() => setActiveSheetName(sheet.name)}
            >
              {sheet.name}
            </button>
          ))}
        </div>

        <footer className="report-workbook-preview-footer">
          <div>
            <strong>{activeSheet?.name || 'Workbook'}</strong>
            <span>
              {activeSheet ? `${activeSheet.shownRows} of ${activeSheet.totalRows} rows shown` : 'No preview rows'}
              {activeSheet?.truncatedRows ? ` · ${activeSheet.truncatedRows} more rows are included in the downloaded Excel file` : ''}
            </span>
          </div>
          <div className="report-workbook-preview-actions">
            <button className="report-secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="report-primary-button" type="button" onClick={onDownload} disabled={!exportData?.contentBase64}>
              <Download size={17} />Download Excel
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
