export type ChatReference = { kind: 'text'; text: string } | { kind: 'skill' | 'file'; text: string; target: string }
export const SKILL_REFERENCE_PREFIX = 'ramu-skill:'
const THREAD_REFERENCE_PREFIX = 'ramu-thread:'

export function threadReference(taskId: string, sessionId: string, seq: number): string {
  return `${THREAD_REFERENCE_PREFIX}${encodeURIComponent(taskId)}/${encodeURIComponent(sessionId)}/${seq}`
}

export function parseThreadReference(url: string) {
  if (!url.startsWith(THREAD_REFERENCE_PREFIX)) return null
  const parts = url.slice(THREAD_REFERENCE_PREFIX.length).split('/')
  if (parts.length !== 3 || !/^[1-9]\d*$/.test(parts[2]!)) return null
  try {
    const taskId = decodeURIComponent(parts[0]!),
      sessionId = decodeURIComponent(parts[1]!),
      seq = Number(parts[2])
    return taskId && sessionId && Number.isSafeInteger(seq) ? { taskId, sessionId, seq } : null
  } catch {
    return null
  }
}

/** Explicit mentions become chips; code, prices, shell variables, and email addresses stay text. */
export function chatReferences(text: string): ChatReference[] {
  const parts: ChatReference[] = []
  const pattern =
    /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)|(^|[\s(])(\$[A-Za-z][A-Za-z\d_:-]*|@"[^"\n]+"|@[\w./-]+(?::\d+(?::\d+)?)?)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match[1]) continue
    const raw = match[3]!,
      start = match.index! + (match[2]?.length ?? 0)
    const quoted = raw.startsWith('@"')
    const token = raw.startsWith('$') || quoted ? raw : raw.replace(/[.,]+$/, '')
    const kind = token.startsWith('$') ? 'skill' : 'file'
    if (kind === 'skill' && /^[A-Z\d_]+$/.test(token.slice(1))) continue
    const target = kind === 'skill' ? token.slice(1) : quoted ? token.slice(2, -1) : token.slice(1)
    if (kind === 'file' && !/[/.]/.test(target) && !/^(README|LICENSE|Makefile|Dockerfile)$/i.test(target)) continue
    if (start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, start) })
    parts.push({ kind, text: token, target })
    cursor = start + token.length
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}

interface ReferenceNode {
  type: string
  value?: string
  url?: string
  children?: ReferenceNode[]
  position?: NodePosition
}
interface NodePosition {
  start: { line: number; column: number; offset?: number }
  end: { line: number; column: number; offset?: number }
}

const shifted = (position: NodePosition, at: number, part: string): NodePosition => {
  const point = (offset: number) => ({ ...position.start, offset: (position.start.offset ?? 0) + offset })
  return { start: point(at), end: point(at + part.length) }
}

/** Transform prose text only: existing links, images, and code retain their meaning. */
export function remarkChatReferences() {
  return (tree: ReferenceNode) => {
    const visit = (node: ReferenceNode) => {
      if (!node.children || ['link', 'linkReference', 'code', 'inlineCode', 'html'].includes(node.type)) return
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text') {
          visit(child)
          return [child]
        }
        const value = child.value ?? ''
        let cursor = 0
        // Text keeps its source position: the streaming fade tells new words from old ones by source offset.
        const text = (part: string): ReferenceNode => {
          const at = value.indexOf(part, cursor)
          if (at < 0) return { type: 'text', value: part }
          cursor = at + part.length
          return {
            type: 'text',
            value: part,
            ...(child.position ? { position: shifted(child.position, at, part) } : {}),
          }
        }
        return chatReferences(value).map((part): ReferenceNode =>
          part.kind === 'text'
            ? text(part.text)
            : {
                type: 'link',
                url: part.kind === 'skill' ? SKILL_REFERENCE_PREFIX + encodeURIComponent(part.target) : part.target,
                children: [text(part.text)],
              },
        )
      })
    }
    visit(tree)
  }
}
