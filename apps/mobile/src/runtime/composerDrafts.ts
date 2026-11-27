import { fileContextKey } from '@ramu/shared/chat/fileContext'
import { explorerAncestors } from '@ramu/shared/workspace/explorer'
import type { FileContext, WorktreeWorkspace } from '@ramu/shared/types'

export type NewComposerOrigin = { projectId: string; draftContext?: string }
export interface ExplorerFileInput {
  computerId: string
  contextId: string
  repoId: string
  path: string
  diff?: boolean | 'all'
  asReference?: boolean
  composer?: NewComposerOrigin
  catalog?: { host: string; rows: WorktreeWorkspace[] }
}
export type ExplorerDestination =
  { kind: 'chat'; chatId: string } | { kind: 'new'; projectId: string; draftContext?: string }
type DraftErrorCode = 'host' | 'scope' | 'file' | 'full' | 'corrupt'
export class ExplorerDraftError extends Error {
  readonly code: DraftErrorCode
  constructor(code: DraftErrorCode) {
    super(code)
    this.code = code
  }
}

/** The message box draft of a thread, shared by its screen and anything that adds to it (its terminal). */
export const composerDraftKey = (chat: { computerId: string; taskId: string; id: string }) =>
  `${chat.computerId}:chat:${chat.taskId || chat.id}`

/** A file-started composer keeps its checkout draft separate from an unrelated Home draft. */
export function newComposerKey(host: string, projectId: string | null, draftContext?: string): string {
  return `${host}:new:${projectId ?? 'none'}${draftContext ? `:files:${encodeURIComponent(draftContext)}` : ''}`
}

export function addExplorerFile(
  state: {
    computers: { id: string; status: string }[]
    projects: { id: string; computerId: string }[]
    chats: { id: string; taskId: string; computerId: string; projectId: string }[]
    drafts: Record<string, string>
  },
  input: ExplorerFileInput,
): { drafts: Record<string, string>; destination: ExplorerDestination; key: string } {
  const { computerId: host, contextId: context, repoId, path } = input
  if (!state.computers.some((h) => h.id === host && h.status === 'online')) throw new ExplorerDraftError('host')
  if (
    !repoId ||
    !explorerAncestors(path).length ||
    (input.diff !== undefined && ![false, true, 'all'].includes(input.diff))
  )
    throw new ExplorerDraftError('file')
  let projectId: string | undefined, workspace: WorktreeWorkspace | undefined
  const chat = state.chats.find((c) => c.computerId === host && c.taskId === context)
  if (chat) projectId = chat.projectId
  else if (context.startsWith('project:')) projectId = `${host}:${context.slice('project:'.length)}`
  else if (context.startsWith('worktree:') && input.catalog?.host === host) {
    workspace = input.catalog.rows.find((row) => row.id === context.slice('worktree:'.length))
    if (workspace) projectId = `${host}:${workspace.projectId}`
  }
  if (
    !projectId ||
    (projectId !== 'no-project' && !state.projects.some((p) => p.id === projectId && p.computerId === host))
  )
    throw new ExplorerDraftError('scope')
  if (input.composer && input.composer.projectId !== projectId) throw new ExplorerDraftError('scope')
  const destination: ExplorerDestination =
    chat && !input.composer
      ? { kind: 'chat', chatId: chat.id }
      : { kind: 'new', projectId, draftContext: input.composer ? input.composer.draftContext : context }
  const key =
    destination.kind === 'chat'
      ? `${host}:chat:${chat!.taskId}`
      : newComposerKey(host, projectId, destination.draftContext)
  let contexts: FileContext[]
  try {
    contexts = JSON.parse(state.drafts[`${key}:context`] ?? '[]')
    if (
      !Array.isArray(contexts) ||
      contexts.some((file) => !file || typeof file.repoId !== 'string' || typeof file.path !== 'string')
    )
      throw Error('Invalid context')
  } catch {
    throw new ExplorerDraftError('corrupt')
  }
  const reference: FileContext = {
    repoId,
    path,
    source: input.asReference ? 'tab' : 'mention',
    referenceOnly: true,
    ...(input.diff !== undefined ? { diff: { staged: input.diff } } : {}),
  }
  const duplicate = contexts.some((file) => fileContextKey(file) === fileContextKey(reference))
  if (!duplicate && contexts.length >= 30) throw new ExplorerDraftError('full')
  if (destination.kind === 'new' && !input.composer && state.drafts[`${key}:workspace`]) {
    try {
      const choice = JSON.parse(state.drafts[`${key}:workspace`]!)
      if (choice.version !== 1) throw new ExplorerDraftError('corrupt')
      if (
        workspace
          ? choice.mode !== 'worktree' || choice.workspaceId !== workspace.id
          : choice.mode !== 'current' || choice.workspaceId
      )
        throw new ExplorerDraftError('scope')
    } catch (error) {
      if (error instanceof ExplorerDraftError) throw error
      throw new ExplorerDraftError('corrupt')
    }
  }
  const drafts = {
    ...state.drafts,
    [`${key}:context`]: JSON.stringify(duplicate ? contexts : [...contexts, reference]),
  }
  // An explicit file-started draft captures checkout intent, without changing the ordinary Home draft.
  if (destination.kind === 'new' && !input.composer && !drafts[`${key}:workspace`])
    drafts[`${key}:workspace`] = JSON.stringify({
      version: 1,
      mode: workspace ? 'worktree' : 'current',
      ...(workspace ? { workspaceId: workspace.id, name: workspace.name } : {}),
    })
  return { drafts, destination, key }
}

export interface ComposerSnapshot {
  text: string
  attachments: string
  context: string
  mentions: string
}

/**
 * A late send acknowledgement cannot consume edits or file additions made after submission began. Only the parts given
 * are compared; the rest are cleared regardless.
 */
export function consumeComposerDraft(
  drafts: Record<string, string>,
  key: string,
  expected: Partial<ComposerSnapshot>,
): Record<string, string> | null {
  if (
    (expected.text !== undefined && (drafts[key] ?? '') !== expected.text) ||
    (expected.attachments !== undefined && (drafts[`${key}:attachments`] ?? '[]') !== expected.attachments) ||
    (expected.context !== undefined && (drafts[`${key}:context`] ?? '[]') !== expected.context) ||
    (expected.mentions !== undefined && (drafts[`${key}:mentions`] ?? '[]') !== expected.mentions)
  )
    return null
  return { ...drafts, [key]: '', [`${key}:attachments`]: '[]', [`${key}:context`]: '[]', [`${key}:mentions`]: '[]' }
}
