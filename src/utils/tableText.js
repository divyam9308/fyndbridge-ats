export const previewWords = (value, count = 3) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  return {
    words,
    isLong: words.length > count,
    preview: words.slice(0, count).join(' ')
  }
}
