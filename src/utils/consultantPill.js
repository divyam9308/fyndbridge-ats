const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#0891B2', '#059669', '#D97706', '#DC2626', '#4F46E5']
const text = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const hash = (value) => [...text(value).toLowerCase()].reduce((current, char) => ((current * 31) + char.charCodeAt(0)) | 0, 0) >>> 0

export function getConsultantInitials(name) {
  const parts = text(name).split(' ').filter(Boolean)
  if (!parts.length || parts[0] === '-') return ''
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase()
}

export const getConsultantAvatarColor = (name) => PALETTE[hash(name) % PALETTE.length]
export const cleanConsultantName = text
