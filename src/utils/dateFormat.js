export const formatDateDDMMYYYY = (value) => {
  const text = String(value || '').trim()
  if (!text) return '-'

  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/)
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`

  const dmyOrMdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmyOrMdy) {
    const first = Number(dmyOrMdy[1])
    const second = Number(dmyOrMdy[2])
    const year = dmyOrMdy[3]
    const day = first > 12 ? first : second
    const month = first > 12 ? second : first
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    }
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return '-'
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}
