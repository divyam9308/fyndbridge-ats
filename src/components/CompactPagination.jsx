import { ChevronLeft, ChevronRight } from 'lucide-react'

function buildCompactPageItems(page, totalPages) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 3) return [1, 2, 3, 'end-ellipsis', totalPages]
  if (page >= totalPages - 2) return [1, 'start-ellipsis', totalPages - 2, totalPages - 1, totalPages]
  return [1, 'start-ellipsis', page - 1, page, page + 1, 'end-ellipsis', totalPages]
}

export default function CompactPagination({ page, totalPages, onPageChange, loading = false }) {
  const safeTotalPages = Math.max(totalPages || 1, 1)
  const safePage = Math.min(Math.max(page || 1, 1), safeTotalPages)
  const items = buildCompactPageItems(safePage, safeTotalPages)

  return (
    <div className="compact-pagination">
      <button
        className="compact-pagination-btn"
        type="button"
        disabled={safePage <= 1 || loading}
        onClick={() => onPageChange(safePage - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={15} />
      </button>
      {items.map((item) => item === 'start-ellipsis' || item === 'end-ellipsis' ? (
        <span className="compact-pagination-ellipsis" key={item}>...</span>
      ) : (
        <button
          key={item}
          className={`compact-pagination-btn${item === safePage ? ' is-active' : ''}`}
          type="button"
          disabled={loading}
          onClick={() => onPageChange(item)}
        >
          {item}
        </button>
      ))}
      <button
        className="compact-pagination-btn"
        type="button"
        disabled={safePage >= safeTotalPages || loading}
        onClick={() => onPageChange(safePage + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}
