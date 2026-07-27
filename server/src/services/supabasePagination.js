const DEFAULT_PAGE_SIZE = 1000

async function fetchEveryPage(queryFactory, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

module.exports = { DEFAULT_PAGE_SIZE, fetchEveryPage }
