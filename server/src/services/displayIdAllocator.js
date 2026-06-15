function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function displayIdNumber(value, prefix) {
  const match = clean(value).match(new RegExp(`^${prefix}\\s*(\\d+)$`, 'i'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

async function allocateNextDisplayId({ supabase, table, column, prefix, select = 'id' }) {
  const { data, error } = await supabase.from(table).select(`${select}, ${column}`).limit(10000)
  if (error) throw error
  const used = new Set(
    (data || [])
      .map((row) => displayIdNumber(row[column], prefix))
      .filter((number) => number < Number.MAX_SAFE_INTEGER)
  )
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

