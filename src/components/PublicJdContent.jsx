import { Fragment } from 'react'

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g

const renderInline = (text, keyPrefix) => String(text || '').split(INLINE_PATTERN).map((part, index) => {
  const key = `${keyPrefix}-${index}`
  if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>
  if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>
  return <Fragment key={key}>{part}</Fragment>
})

export default function PublicJdContent({ value }) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []

  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    const unordered = line.match(/^\s*[-*]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)

    if (unordered || ordered) {
      const items = []
      const orderedList = Boolean(ordered)
      while (index < lines.length) {
        const match = lines[index].match(orderedList ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*]\s+(.+)$/)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      const List = orderedList ? 'ol' : 'ul'
      blocks.push(<List key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>)}</List>)
      continue
    }

    if (/^\s*$/.test(line)) {
      index += 1
      continue
    }

    const heading = line.match(/^##\s+(.+)$/)
    const quote = line.match(/^>\s?(.+)$/)
    if (heading) blocks.push(<h4 key={`heading-${index}`}>{renderInline(heading[1], `heading-${index}`)}</h4>)
    else if (quote) blocks.push(<blockquote key={`quote-${index}`}>{renderInline(quote[1], `quote-${index}`)}</blockquote>)
    else blocks.push(<p key={`paragraph-${index}`}>{renderInline(line, `paragraph-${index}`)}</p>)
    index += 1
  }

  return blocks
}
