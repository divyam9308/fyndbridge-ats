function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function displayIdNumber(value, prefix) {
  const match = clean(value).match(new RegExp(`^${prefix}\\s*(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

async function allocateNextDisplayId({ supabase, table, column, prefix, select = 'id', mode = 'first_gap' }) {
  const data = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from(table)
      .select(`${select}, ${column}`)
      .range(from, from + pageSize - 1)
    if (error) throw error
    data.push(...(page || []))
    if (!page || page.length < pageSize) break
  }
  const numbers = (data || [])
    .map((row) => displayIdNumber(row[column], prefix))
    .filter((number) => number < Number.MAX_SAFE_INTEGER)
  if (mode === 'max_plus_one') return `${prefix}${Math.max(0, ...numbers) + 1}`
  const used = new Set(numbers)
  let next = 1
  while (used.has(next)) next += 1
  return `${prefix}${next}`
}

function isDisplayIdUniqueError(error, column) {
  return error?.code === '23505' && new RegExp(column, 'i').test(String(error.message || ''))
}

module.exports = {
  allocateNextDisplayId,
  isDisplayIdUniqueError
}

