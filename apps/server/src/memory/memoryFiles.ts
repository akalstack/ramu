// Markdown layout of the shared memory, so people can read and edit it like Claude's MEMORY.md and Hermes' USER.md:
//   USER.md                          who the user is (global notes of kind "user")
//   MEMORY.md                        global notes of every other kind
//   projects/<projectId>/MEMORY.md   notes for one project
//   ARCHIVE.md                       retired notes, restorable by moving a block back
// Each note is a marker line carrying its metadata, a "### Title" line, and the text. Edit the title or text freely and
// keep the marker line; Ramu picks the change up. A block with an empty marker (`{}`) adds a new note.
import { MEMORY_KINDS, type Memory, type MemoryKind } from '@ramu/shared/types'

export const USER_FILE = 'USER.md'
export const MEMORY_FILE = 'MEMORY.md'
export const ARCHIVE_FILE = 'ARCHIVE.md'

const MARKER = /^<!-- ramu:note (.*) -->\s*$/
const HEADERS: Record<string, string> = {
  [USER_FILE]: 'Who the user is: role, preferences and working style. Agents of every provider read this.',
  [ARCHIVE_FILE]: 'Retired notes. Move a block into USER.md or MEMORY.md to restore it.',
}
const header = (path: string) =>
  `<!-- Managed by Ramu. ${HEADERS[path] ?? 'Durable notes shared by every provider and thread.'}\nEdit titles and text freely; keep each "ramu:note" line. Delete a block to archive the note. -->\n`

export interface FileNote {
  meta: Partial<Memory>
  title: string
  content: string
}

/** Which file a note lives in. */
export function pathFor(m: Pick<Memory, 'status' | 'projectId' | 'kind'>): string {
  if (m.status === 'archived') return ARCHIVE_FILE
  if (m.projectId?.startsWith('identity:'))
    return `identities/${m.projectId.slice(9).replace(/[^\w.-]/g, '_')}/${MEMORY_FILE}`
  if (m.projectId) return `projects/${m.projectId.replace(/[^\w.-]/g, '_')}/${MEMORY_FILE}`
  return m.kind === 'user' ? USER_FILE : MEMORY_FILE
}

/** The project a path stands for, when it is one of the per-project files. */
export const projectOfPath = (path: string): string | null => /^projects\/([^/]+)\//.exec(path)?.[1] ?? null

const neutral = (text: string) => text.replace(/<!-- ramu:note/g, '<!-​- ramu:note')

export function render(path: string, notes: Memory[]): string {
  const blocks = [...notes]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((m) => {
      const meta = {
        id: m.id,
        projectId: m.projectId,
        kind: m.kind,
        tags: m.tags,
        importance: m.importance,
        status: m.status,
        archivedReason: m.archivedReason,
        source: m.source,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        expiresAt: m.expiresAt,
      }
      return `<!-- ramu:note ${JSON.stringify(meta)} -->\n### ${m.title.replace(/\s+/g, ' ')}\n${neutral(m.content)}\n`
    })
  return `${header(path)}${blocks.length ? `\n${blocks.join('\n')}` : ''}`
}

/** Blocks that could not be read are counted, so the caller can leave the file alone instead of overwriting a typo. */
export function parse(text: string): { notes: FileNote[]; bad: number } {
  const notes: FileNote[] = []
  let bad = 0
  let meta: Partial<Memory> | null = null
  let body: string[] = []
  const close = () => {
    if (!meta) return
    const lines = body.join('\n').trim().split('\n')
    const first = lines[0]?.match(/^###\s+(.+)$/)
    if (!first) {
      bad++
      return
    }
    const kind = meta.kind
    if (kind !== undefined && !MEMORY_KINDS.includes(kind as MemoryKind)) {
      bad++
      return
    }
    notes.push({ meta, title: first[1]!.trim(), content: lines.slice(1).join('\n').trim() })
  }
  for (const line of text.split('\n')) {
    const m = MARKER.exec(line)
    if (!m) {
      if (meta) body.push(line)
      continue
    }
    close()
    body = []
    try {
      const parsed = JSON.parse(m[1]!)
      meta = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
      if (!meta) bad++
    } catch {
      meta = null
      bad++
    }
  }
  close()
  return { notes, bad }
}
