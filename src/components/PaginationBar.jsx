function getPageNumbers(page, totalPages) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  return [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b)
}

export default function PaginationBar({ page, totalPages, total, pageSize, onPageChange, onPageSizeChange, loading = false }) {
  const pages = getPageNumbers(page, totalPages)

  return (
    <div className="pagination-bar">
      <label className="pagination-size">
        <span>Rows per page</span>
        <select className="filter-select compact-select" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={loading}>
          {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <button className="btn-secondary" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Previous</button>
      <div className="pagination-pages">
        {pages.map((value) => (
          <button
            key={value}
            className={`btn-secondary pagination-page-btn${value === page ? ' is-active' : ''}`}
            disabled={loading}
            onClick={() => onPageChange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <span>Page {page} of {totalPages}</span>
      <span>{total.toLocaleString('en-IN')} total</span>
      <button className="btn-secondary" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  )
}
