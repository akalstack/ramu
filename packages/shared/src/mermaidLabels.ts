// The labels in a Mermaid flowchart (node text and edge text), so a person can change the words on a diagram without
// its syntax. Each label is replaced where it stands; ids, arrows and layout stay as written.

interface Span {
  start: number
  end: number
  text: string
}

/** Node text after an id (`A[Text]`, `B(Text)`, `C{Text}`, doubled shapes too), and edge text (`-->|Text|`). */
const LABEL =
  /(?<=[A-Za-z0-9_])(?:\[\[|\[\(|\(\(|\(\[|\{\{|\[\/|\[\\|\[|\(|\{|>)("[^"\n]*"|[^[\](){}|"\n]+)(?:\]\]|\)\]|\)\)|\]\)|\}\}|\/\]|\\\]|\]|\)|\})|\|("[^"\n]*"|[^|\n]+)\|/g

function spans(source: string): Span[] {
  if (!/^\s*(?:flowchart|graph)\b/.test(source)) return []
  const found: Span[] = []
  for (const match of source.matchAll(LABEL)) {
    const raw = match[1] ?? match[2]!
    const offset = match.index! + match[0].indexOf(raw)
    const quoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
    const start = quoted ? offset + 1 : offset
    const end = quoted ? offset + raw.length - 1 : offset + raw.length
    const text = source.slice(start, end)
    // Comments and the header are not labels.
    const line = source.slice(source.lastIndexOf('\n', offset) + 1, offset)
    if (line.trimStart().startsWith('%%') || !text.trim()) continue
    found.push({ start, end, text })
  }
  return found
}

/** A flowchart's labels in source order; empty for other diagram types. */
export function mermaidLabels(source: string): string[] {
  return spans(source).map((span) => span.text.trim())
}

/** The source with each label replaced; an emptied label keeps its words. Refused if the labels no longer line up. */
export function withMermaidLabels(source: string, labels: string[]): string {
  const found = spans(source)
  if (found.length !== labels.length)
    throw new Error('The diagram changed while you were editing. Reopen it and edit again.')
  let out = source
  for (let index = found.length - 1; index >= 0; index--) {
    const span = found[index]!
    const next = labels[index]!.replace(/[\n"|[\](){}]/g, ' ').trim()
    if (!next || next === span.text.trim()) continue
    out = out.slice(0, span.start) + next + out.slice(span.end)
  }
  return out
}
