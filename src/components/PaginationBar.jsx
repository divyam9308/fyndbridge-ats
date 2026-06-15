import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function buildPageItems(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 3) return [1, 2, 3, 4, 5, 'end-ellipsis', totalPages]
  if (page >= totalPages - 1) return [1, 'start-ellipsis', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, 'start-ellipsis', page - 2, page - 1, page, page + 1, page + 2, 'end-ellipsis', totalPages]
}

export default function PaginationBar({
  page,
  totalPages,
  total,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  loading = false,
}) {
  const safeTotal = Number(totalCount ?? total ?? 0)
  const safePage = Math.min(Math.max(page || 1, 1), Math.max(totalPages || 1, 1))
  const safeTotalPages = Math.max(totalPages || 1, 1)
  const [goToValue, setGoToValue] = useState(String(safePage))

  useEffect(() => {
    setGoToValue(String(safePage))
  }, [safePage])

  const pageItems = useMemo(() => buildPageItems(safePage, safeTotalPages), [safePage, safeTotalPages])
  const startResult = safeTotal === 0 ? 0 : (safePage - 1) * pageSize + 1
  const endResult = safeTotal === 0 ? 0 : Math.min(safeTotal, safePage * pageSize)

  const commitGoToPage = () => {
    const parsed = Number.parseInt(goToValue, 10)
    if (!Number.isFinite(parsed)) {
      setGoToValue(String(safePage))
      return
    }
    const nextPage = Math.min(Math.max(parsed, 1), safeTotalPages)
    setGoToValue(String(nextPage))
    if (nextPage !== safePage) onPageChange(nextPage)
  }

  return (
    <div className="pagination-bar">
      <div className="pagination-section pagination-section-left">
        <label className="pagination-size">
          <select
            className="filter-select pagination-select"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            disabled={loading}
          >
            {pageSizeOptions.map((size) => <option key={size} value={size}>{`${size} per page`}</option>)}
          </select>
        </label>
      </div>

      <div className="pagination-divider" />

      <div className="pagination-section pagination-section-center">
        <div className="pagination-pages">
          <button
            className="pagination-circle-btn"
            type="button"
            disabled={safePage <= 1 || loading}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          {pageItems.map((item) => item === 'start-ellipsis' || item === 'end-ellipsis' ? (
            <span className="pagination-ellipsis" key={item}>...</span>
          ) : (
            <button
              key={item}
              className={`pagination-circle-btn${item === safePage ? ' is-active' : ''}`}
              type="button"
              disabled={loading}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ))}
          <button
            className="pagination-circle-btn"
            type="button"
            disabled={safePage >= safeTotalPages || loading}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="pagination-results">{`Showing ${startResult}\u2013${endResult} of ${safeTotal.toLocaleString('en-IN')} results`}</div>
      </div>

      <div className="pagination-divider" />

      <div className="pagination-section pagination-section-right">
        <span className="pagination-go-label">Go to page</span>
        <input
          className="pagination-go-input"
          inputMode="numeric"
          value={goToValue}
          onChange={(event) => setGoToValue(event.target.value)}
          onBlur={commitGoToPage}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitGoToPage()
            }
          }}
          disabled={loading}
        />
        <span className="pagination-go-total">{`of ${safeTotalPages}`}</span>
      </div>
    </div>
  )
}
