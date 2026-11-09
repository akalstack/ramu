import { forgeCommentMarkdown } from '@ramu/shared/forgeMarkdown'

// Pull request descriptions and comments carry the HTML GitHub allows. The desktop renders it through the DOM; the
// phone's native Markdown renderer has none, so the HTML is turned into the Markdown that draws the same thing, and
// <details> into folds the screen draws itself. A tag with no Markdown form keeps its text and loses the tag, so no raw
// markup ever shows.

export type ForgeSegment =
  { kind: 'markdown'; text: string } | { kind: 'details'; summary: string; body: string; open: boolean }

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ENTITIES[name.toLowerCase()] ?? match
  })

const attribute = (tag: string, name: string) =>
  tag
    .match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    ?.slice(1)
    .find(Boolean) ?? ''

/**
 * Code spans and fences, which keep their text as written; suggestions become the lines they add. Each waits behind a
 * private-use placeholder no comment contains, while the HTML around it is rewritten.
 */
function shield(text: string, say: (key: string) => string) {
  const kept: string[] = []
  const body = text.replace(/```[^\n]*\n(?:[\s\S]*?\n)?```|`[^`\n]+`/g, (code) => {
    const suggestion = code.match(/^```suggestion[^\n]*\n([\s\S]*?)\n?```$/)
    const shown = suggestion
      ? suggestion[1]!.trim()
        ? `**${say('Suggested change')}**\n\n\`\`\`diff\n${suggestion[1]!
            .replace(/\n$/, '')
            .split('\n')
            .map((line) => `+${line}`)
            .join('\n')}\n\`\`\``
        : `**${say('Suggests removing these lines')}**`
      : code
    kept.push(shown)
    return `\uE000${kept.length - 1}\uE001`
  })
  return { body, restore: (value: string) => value.replace(/\uE000(\d+)\uE001/g, (_, index) => kept[Number(index)]!) }
}

/** HTML outside code, as the Markdown that draws it. */
function htmlToMarkdown(text: string) {
  return decode(
    text
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = attribute(tag, 'src')
        return src ? `\n\n![${attribute(tag, 'alt')}](${src})\n\n` : ''
      })
      .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner: string) => {
        const href = attribute(tag, 'href')
        return href && inner.trim() ? `[${inner.trim()}](${href})` : inner
      })
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''))
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => (inner.trim() ? `_${inner.trim()}_` : ''))
      .replace(/<(s|del|strike)>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) =>
        inner.trim() ? `~~${inner.trim()}~~` : '',
      )
      .replace(/<code>([^<`]*)<\/code>/gi, (_, inner: string) => `\`${inner}\``)
      .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
        return `\n\n${'#'.repeat(Number(level))} ${inner.replace(/\s+/g, ' ').trim()}\n\n`
      })
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|ul|ol|table|blockquote|pre|tr)>/gi, '\n\n')
      .replace(/<\/(td|th)>/gi, '  ')
      .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** The <details> folds at the top level of `text`, with what lies between them. Nested folds stay in their body. */
function folds(text: string): ({ kind: 'text'; text: string } | { kind: 'details'; inner: string; open: boolean })[] {
  const parts: ({ kind: 'text'; text: string } | { kind: 'details'; inner: string; open: boolean })[] = []
  const tag = /<(\/?)details\b([^>]*)>/gi
  let depth = 0
  let start = 0
  let openedAt = 0
  let open = false
  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    if (!match[1]) {
      if (depth++ === 0) {
        parts.push({ kind: 'text', text: text.slice(start, match.index) })
        openedAt = match.index + match[0].length
        open = /\bopen\b/i.test(match[2]!)
      }
    } else if (depth > 0 && --depth === 0) {
      parts.push({ kind: 'details', inner: text.slice(openedAt, match.index), open })
      start = match.index + match[0].length
    }
  }
  // An unclosed fold runs to the end, as a browser draws it.
  if (depth > 0) parts.push({ kind: 'details', inner: text.slice(openedAt), open })
  else parts.push({ kind: 'text', text: text.slice(start) })
  return parts
}

/** A description or comment as the parts the phone draws: Markdown, and folds holding their own body to read the same way. */
export function forgeSegments(body: string, say: (key: string) => string = (key) => key): ForgeSegment[] {
  const { body: shielded, restore } = shield(forgeCommentMarkdown(body), say)
  const segments: ForgeSegment[] = []
  for (const part of folds(shielded.replace(/<!--[\s\S]*?(?:-->|$)/g, ''))) {
    if (part.kind === 'text') {
      const text = restore(htmlToMarkdown(part.text)).trim()
      if (text) segments.push({ kind: 'markdown', text })
      continue
    }
    const summary = part.inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)
    const inner = summary ? part.inner.replace(summary[0], '') : part.inner
    segments.push({
      kind: 'details',
      // The summary is drawn as a control's label, so emphasis marks would show as written.
      summary: summary
        ? restore(htmlToMarkdown(summary[1]!))
            .replace(/\*\*|__|~~|`/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        : '',
      body: restore(inner),
      open: part.open,
    })
  }
  return segments
}
