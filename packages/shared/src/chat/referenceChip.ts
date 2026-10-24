import type { DraftChip } from './composerDraft'
import { localFileLink } from '../workspace/fileLinks'

/**
 * The chip a reference in chat becomes (an `@file`, a folder, a `$skill`, a `/command`, a quote). Desktop and phone
 * draw it with their own inline widgets, using chat/presentation as the shared visual reference. What the chip says, which kind it is and
 * what it opens come from here, so the two cannot drift apart.
 */
export type ReferenceChipKind = 'file' | 'folder' | 'skill' | 'command' | 'quote'

export interface ReferenceChip {
  kind: ReferenceChipKind
  /** What the chip shows: a file's name (with `:line`), a skill's name, a quote's text on one line. */
  label: string
  /** The full path or name, for a tooltip and for accessibility. */
  title: string
  /** For file and folder chips: the path as written, which the app resolves against the chat's folders. */
  target?: string
  line?: number
  column?: number
}

const FILE_WITHOUT_EXTENSION = /(?:^|\/)(?:README|LICENSE|Makefile|Dockerfile)$/i

/** A path whose last part has no extension (`apps/web`, `src/`) is most likely a folder; the host decides for sure. */
export function isFolderLike(path: string): boolean {
  return /\/$/.test(path) || !(/\.[^/]+$/.test(path) || FILE_WITHOUT_EXTENSION.test(path))
}

/** A file or folder reference. `label` overrides the shown name (a Markdown link keeps the words its author chose). */
export function fileChip(target: string, label?: string): ReferenceChip | null {
  const local = localFileLink(target)
  if (!local) return null
  const name = local.path.replace(/\/$/, '').split('/').at(-1) || local.path
  return {
    kind: isFolderLike(local.path) ? 'folder' : 'file',
    label: label ?? (local.line ? `${name}:${local.line}` : name),
    title: target,
    target,
    ...(local.line ? { line: local.line, column: local.column } : {}),
  }
}

export const skillChip = (name: string): ReferenceChip => ({ kind: 'skill', label: name, title: name })

/** The chip for a reference found in a message or the composer draft. */
export function draftChip(part: Pick<DraftChip, 'kind' | 'label' | 'target'>): ReferenceChip {
  if (part.kind === 'skill') return skillChip(part.target ?? part.label)
  if (part.kind === 'file')
    return fileChip(part.target ?? part.label) ?? { kind: 'file', label: part.label, title: part.label }
  return { kind: part.kind, label: part.label.replace(/\s*\n\s*/g, ' '), title: part.label }
}
