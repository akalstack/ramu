import {
  moveMessageDraft,
  readSavedDrafts,
  SavedDraftError,
  type MessageDraftSnapshot,
  type SavedDraftCommand,
  type SavedDraftScope,
} from '@ramu/shared/chat/savedDrafts'

export const savedMessagesKey = (host: string) => `${host}:saved-messages`

/** Additive: legacy text and context/mention/attachment sidecars keep their original keys. */
export function mobileMessageDraft(drafts: Record<string, string>, key: string): MessageDraftSnapshot {
  try {
    const parse = (suffix: string) => JSON.parse(drafts[`${key}:${suffix}`] ?? '[]')
    const workspace = drafts[`${key}:workspace`] ? JSON.parse(drafts[`${key}:workspace`]!) : undefined
    if (workspace && workspace.version !== 1) throw new SavedDraftError('version')
    return {
      text: drafts[key] ?? '',
      attachments: parse('attachments'),
      context: parse('context'),
      mentions: parse('mentions'),
      ...(workspace
        ? {
            workspace: {
              mode: workspace.mode,
              workspaceId: workspace.workspaceId,
              name: workspace.name,
              branch: workspace.branch,
            },
          }
        : {}),
    }
  } catch (error) {
    if (error instanceof SavedDraftError) throw error
    throw new SavedDraftError('invalid')
  }
}

/** The caller writes this entire result before replacing any visible composer state. */
export function moveMobileMessageDraft(input: {
  drafts: Record<string, string>
  knownHosts: readonly string[]
  hostId: string
  key: string
  scope: SavedDraftScope
  expectedRevision: number
  expectedActive: MessageDraftSnapshot
  command: SavedDraftCommand
}) {
  const { drafts, hostId, key } = input
  if (!input.knownHosts.includes(hostId) || !key.startsWith(`${hostId}:`) || input.scope.id !== key)
    throw new SavedDraftError('host')
  const library = readSavedDrafts(drafts[savedMessagesKey(hostId)] ?? null, hostId)
  const moved = moveMessageDraft({ ...input, library, active: mobileMessageDraft(drafts, key) })
  const next = {
    ...drafts,
    [savedMessagesKey(hostId)]: JSON.stringify(moved.library),
    [key]: moved.active.text,
    [`${key}:attachments`]: JSON.stringify(moved.active.attachments),
    [`${key}:context`]: JSON.stringify(moved.active.context),
    [`${key}:mentions`]: JSON.stringify(moved.active.mentions),
  }
  if (input.command.kind === 'restore')
    next[`${key}:restored-attachments`] = moved.active.attachments.length ? 'yes' : ''
  if (input.command.kind === 'save') next[`${key}:restored-attachments`] = ''
  if (moved.active.workspace) next[`${key}:workspace`] = JSON.stringify({ version: 1, ...moved.active.workspace })
  else delete next[`${key}:workspace`]
  return { ...moved, drafts: next }
}
