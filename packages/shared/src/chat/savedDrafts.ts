import { parseBranchNameDraft, type WorkspaceChoice } from '@ramu/shared/workspaceDefaults'
import type { Attachment, FileContext } from '../types'
import { chatReferences } from '@ramu/shared/chat/chatReferences'

/** Explicit saves have no expiry. Limits reject a move; they never truncate or evict saved work. */
export const SAVED_DRAFT_LIMITS = { items: 40, text: 200_000, storageBytes: 4 * 1024 * 1024 } as const

export interface SavedDraftScope {
  kind: 'thread' | 'new'
  id: string
  /** Stable device thread identity while an offline placeholder receives its host task ID. */
  threadId?: string
  projectId?: string
  contextId?: string
  label?: string
}
export interface DraftMention {
  file: { repoId: string; path: string }
  insertion: string
  token?: string
}
export interface MessageDraftSnapshot {
  text: string
  attachments: Attachment[]
  context: FileContext[]
  mentions: DraftMention[]
  /** null follows the host default; an explicit mode or existing workspace remains explicit. */
  workspace?: WorkspaceChoice
}
export interface SavedMessageDraft {
  hostId: string
  id: string
  revision: number
  savedAt: number
  scope: SavedDraftScope
  snapshot: MessageDraftSnapshot
}
export interface SavedDraftLibrary {
  version: 1
  hostId: string
  revision: number
  items: SavedMessageDraft[]
}
export type SavedDraftProblem =
  'invalid' | 'version' | 'host' | 'conflict' | 'empty' | 'full' | 'recovery-size' | 'uploading' | 'scope'
export class SavedDraftError extends Error {
  readonly code: SavedDraftProblem
  constructor(code: SavedDraftProblem) {
    super(`saved-draft:${code}`)
    this.code = code
  }
}
const fail = (code: SavedDraftProblem): never => {
  throw new SavedDraftError(code)
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))
const string = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max
const id = (value: unknown): value is string => string(value) && !!value.trim()
const optionalString = (value: unknown, max = 2000) => value === undefined || string(value, max)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const relativePath = (value: unknown) =>
  id(value) &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.split('/').some((part) => part === '..' || part === '.')

function validContext(value: unknown): boolean {
  if (
    !record(value) ||
    !keys(value, ['repoId', 'path', 'content', 'referenceOnly', 'selection', 'diff', 'source']) ||
    !id(value.repoId) ||
    !relativePath(value.path) ||
    !['tab', 'mention'].includes(value.source as string) ||
    !optionalString(value.content, 1_000_000) ||
    (value.referenceOnly !== undefined && typeof value.referenceOnly !== 'boolean')
  )
    return false
  if (value.selection !== undefined) {
    const selection = value.selection
    if (
      !record(selection) ||
      !keys(selection, ['startLine', 'startColumn', 'endLine', 'endColumn', 'side']) ||
      !['startLine', 'startColumn', 'endLine', 'endColumn'].every(
        (key) => integer(selection[key]) && (selection[key] as number) > 0,
      ) ||
      (selection.side !== undefined && !['original', 'modified'].includes(selection.side as string))
    )
      return false
    if (
      (selection.endLine as number) < (selection.startLine as number) ||
      (selection.endLine === selection.startLine && (selection.endColumn as number) < (selection.startColumn as number))
    )
      return false
  }
  if (value.diff !== undefined) {
    const diff = value.diff
    if (
      !record(diff) ||
      !keys(diff, ['staged', 'oid', 'stash']) ||
      ![true, false, 'all'].includes(diff.staged as boolean) ||
      (diff.oid !== undefined && (typeof diff.oid !== 'string' || !/^[a-f0-9]{4,64}$/i.test(diff.oid))) ||
      (diff.stash !== undefined && typeof diff.stash !== 'boolean')
    )
      return false
  }
  return true
}

function validAttachment(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['id', 'name', 'size', 'mimeType', 'path']) &&
    id(value.id) &&
    id(value.name) &&
    id(value.mimeType) &&
    id(value.path) &&
    integer(value.size) &&
    value.size > 0 &&
    value.size <= 10 * 1024 * 1024
  )
}
function validMention(value: unknown): boolean {
  return (
    record(value) &&
    keys(value, ['file', 'insertion', 'token']) &&
    record(value.file) &&
    keys(value.file, ['repoId', 'path']) &&
    id(value.file.repoId) &&
    relativePath(value.file.path) &&
    id(value.insertion) &&
    optionalString(value.token)
  )
}
function validScope(value: unknown): value is SavedDraftScope {
  return (
    record(value) &&
    keys(value, ['kind', 'id', 'threadId', 'projectId', 'contextId', 'label']) &&
    ['thread', 'new'].includes(value.kind as string) &&
    id(value.id) &&
    [value.threadId, value.projectId, value.contextId, value.label].every((entry) => optionalString(entry))
  )
}
function validSnapshot(value: unknown): value is MessageDraftSnapshot {
  if (
    !record(value) ||
    !keys(value, ['text', 'attachments', 'context', 'mentions', 'workspace']) ||
    !string(value.text, SAVED_DRAFT_LIMITS.text) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 10 ||
    !value.attachments.every(validAttachment) ||
    !Array.isArray(value.context) ||
    value.context.length > 30 ||
    !value.context.every(validContext) ||
    !Array.isArray(value.mentions) ||
    value.mentions.length > 30 ||
    !value.mentions.every(validMention)
  )
    return false
  if (value.workspace !== undefined) {
    const ws = value.workspace
    if (
      !record(ws) ||
      !keys(ws, ['mode', 'workspaceId', 'name', 'branch']) ||
      ![null, 'current', 'worktree'].includes(ws.mode as string) ||
      !optionalString(ws.name) ||
      (ws.branch !== undefined && !parseBranchNameDraft(ws.branch)) ||
      (ws.workspaceId !== undefined && (ws.mode !== 'worktree' || !id(ws.workspaceId)))
    )
      return false
  }
  return true
}
const validItem = (value: unknown): value is SavedMessageDraft =>
  record(value) &&
  keys(value, ['hostId', 'id', 'revision', 'savedAt', 'scope', 'snapshot']) &&
  id(value.hostId) &&
  id(value.id) &&
  integer(value.revision) &&
  value.revision > 0 &&
  integer(value.savedAt) &&
  validScope(value.scope) &&
  validSnapshot(value.snapshot)

export const emptyMessageDraft = (): MessageDraftSnapshot => ({ text: '', attachments: [], context: [], mentions: [] })
export const hasMessageDraft = (snapshot: MessageDraftSnapshot) =>
  !!snapshot.text.trim() || !!snapshot.attachments.length || !!snapshot.context.length
export const savedDraftScopeKey = (scope: SavedDraftScope) =>
  JSON.stringify([
    scope.kind,
    scope.kind === 'thread' ? (scope.threadId ?? scope.id) : scope.id,
    scope.projectId ?? null,
    scope.contextId ?? null,
  ])
export const emptySavedDrafts = (hostId: string): SavedDraftLibrary => {
  if (!id(hostId)) return fail('host')
  return { version: 1, hostId, revision: 0, items: [] }
}

/** Throws without changing the raw source. Unknown versions/corruption must never become an empty library. */
export function readSavedDrafts(raw: string | null, hostId: string): SavedDraftLibrary {
  if (raw === null) return emptySavedDrafts(hostId)
  if (raw.length * 2 > SAVED_DRAFT_LIMITS.storageBytes) return fail('full')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fail('invalid')
  }
  if (!record(value)) return fail('invalid')
  if (value.version !== 1) return fail('version')
  if (value.hostId !== hostId || !id(hostId)) return fail('host')
  if (
    !keys(value, ['version', 'hostId', 'revision', 'items']) ||
    !integer(value.revision) ||
    !Array.isArray(value.items) ||
    value.items.length > SAVED_DRAFT_LIMITS.items ||
    !value.items.every((item) => validItem(item) && item.hostId === hostId) ||
    new Set(value.items.map((item) => item.id)).size !== value.items.length
  )
    return fail('invalid')
  return value as unknown as SavedDraftLibrary
}

export type SavedDraftCommand =
  | { kind: 'save'; id: string; at: number; uploadsPending?: boolean }
  | { kind: 'restore' | 'restore-here'; id: string; itemRevision: number; parkId?: string; at: number }
  | { kind: 'delete'; id: string; itemRevision: number }
  | { kind: 'undo-delete'; item: SavedMessageDraft }

/** References from another checkout remain readable data, never new live file/skill bindings. */
function recoverMessageDraft(source: MessageDraftSnapshot, destination: MessageDraftSnapshot): MessageDraftSnapshot {
  const literal = (value: string, block = false) => {
    let length = block ? 3 : 1
    for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
    const fence = '`'.repeat(length)
    return block ? `${fence}json\n${value}\n${fence}` : `${fence} ${value} ${fence}`
  }
  let text = chatReferences(source.text)
    .map((part) => {
      if (part.kind === 'text') return part.text
      const mention = source.mentions.find((entry) => (entry.token ?? entry.insertion).trim() === part.text)
      return literal(mention ? `${mention.file.repoId}/${mention.file.path}` : part.text)
    })
    .join('')
  if (source.context.length || source.mentions.length) {
    text += `\n\n${literal(JSON.stringify({ context: source.context, mentions: source.mentions }, null, 2), true)}`
  }
  if (text.length > SAVED_DRAFT_LIMITS.text) return fail('recovery-size')
  return {
    text,
    attachments: source.attachments,
    context: [],
    mentions: [],
    ...(destination.workspace ? { workspace: destination.workspace } : {}),
  }
}

/**
 * One pure move: the client durably commits library AND active together before updating its composer.
 * Exact expected snapshots/revisions prevent delayed/double actions from clearing newer edits. No delivery side effects.
 */
export function moveMessageDraft(input: {
  library: SavedDraftLibrary
  hostId: string
  expectedRevision: number
  scope: SavedDraftScope
  active: MessageDraftSnapshot
  expectedActive: MessageDraftSnapshot
  command: SavedDraftCommand
}): { library: SavedDraftLibrary; active: MessageDraftSnapshot; deleted?: SavedMessageDraft } {
  const { library, hostId, scope, active, expectedActive, command } = input
  readSavedDrafts(JSON.stringify(library), hostId)
  if (library.revision !== input.expectedRevision || JSON.stringify(active) !== JSON.stringify(expectedActive))
    return fail('conflict')
  if (!validScope(scope) || !validSnapshot(active)) return fail('invalid')
  if (!Number.isSafeInteger(library.revision + 1)) return fail('full')
  const next: SavedDraftLibrary = { ...library, revision: library.revision + 1, items: [...library.items] }
  let result = active,
    deleted: SavedMessageDraft | undefined
  const save = (id: string, at: number) => {
    if (!string(id) || !id.trim() || !integer(at)) return fail('invalid')
    if (next.items.some((item) => item.id === id)) return fail('conflict')
    if (!hasMessageDraft(active)) return fail('empty')
    next.items.unshift({ hostId, id, revision: 1, savedAt: at, scope, snapshot: active })
  }
  if (command.kind === 'save') {
    if (command.uploadsPending) return fail('uploading')
    save(command.id, command.at)
    result = { ...emptyMessageDraft(), ...(active.workspace ? { workspace: active.workspace } : {}) }
  } else if (command.kind === 'undo-delete') {
    if (!validItem(command.item)) return fail('invalid')
    if (command.item.hostId !== hostId) return fail('host')
    if (next.items.some((item) => item.id === command.item.id)) return fail('conflict')
    next.items.unshift(command.item)
  } else {
    const item = next.items.find((item) => item.id === command.id)
    if (!item || item.revision !== command.itemRevision) return fail('conflict')
    next.items = next.items.filter((entry) => entry.id !== item.id)
    if (command.kind === 'delete') deleted = item
    else {
      const sameScope = savedDraftScopeKey(item.scope) === savedDraftScopeKey(scope)
      if (command.kind === 'restore' ? !sameScope : sameScope) return fail('scope')
      if (hasMessageDraft(active)) {
        if (!command.parkId) return fail('conflict')
        save(command.parkId, command.at)
      }
      result = command.kind === 'restore-here' ? recoverMessageDraft(item.snapshot, active) : item.snapshot
    }
  }
  if (next.items.length > SAVED_DRAFT_LIMITS.items || JSON.stringify(next).length * 2 > SAVED_DRAFT_LIMITS.storageBytes)
    return fail('full')
  // The caller cannot mutate the saved source through an old composer object after this move.
  return JSON.parse(JSON.stringify({ library: next, active: result, ...(deleted ? { deleted } : {}) }))
}

/** Metadata is not proof of bytes. Every restored attachment starts unverified on its original host. */
export function savedDraftAttachments(snapshot: MessageDraftSnapshot) {
  return snapshot.attachments.map((file) => ({ file, availability: 'unverified' as const }))
}
