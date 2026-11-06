import type { ConflictChoice } from '@ramu/shared/conflicts'
import type { AgentSettings } from '@ramu/shared/types'
import type { useStore } from './store'

export const CHOICES = ['current', 'incoming', 'both'] as const satisfies readonly ConflictChoice[]

/** The three sides, in the words editors use, for one conflict or one file. English copy for the caller to translate. */
export const CHOICE_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current',
  incoming: 'Accept incoming',
  both: 'Accept both',
}

/** The same sides for every conflicted file at once. */
export const ALL_FILES_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current in all files',
  incoming: 'Accept incoming in all files',
  both: 'Accept both in all files',
}

/** The confirmation's question before one side replaces every conflict in every file. */
export const ALL_FILES_TITLE: Record<ConflictChoice, string> = {
  current: 'Keep the current side in every conflicted file?',
  incoming: 'Keep the incoming side in every conflicted file?',
  both: 'Keep both sides in every conflicted file?',
}

type Invoke = ReturnType<typeof useStore>['invoke']

interface ConflictWork {
  repoName: string
  cwd: string
  /** The operation that stopped on the conflicts: `merge` or `rebase`. */
  kind: string
  paths: string[]
  /** Every conflicted file, rather than a chosen few. */
  whole: boolean
}

/** The opening message the desktop sends for the same conflicts, so a thread started on the phone works the same way. */
export function conflictPrompt({ repoName, cwd, kind, paths, whole }: ConflictWork): string {
  return [
    `Resolve ${paths.length} ${kind} ${paths.length === 1 ? 'conflict' : 'conflicts'} in ${repoName}.`,
    '',
    '<ramu-context>',
    `Repository: ${repoName} (${cwd})`,
    whole ? 'Conflicted files:' : 'Resolve only these files; leave other conflicted files as they are:',
    ...paths.map((path) => `- ${path}`),
    '',
    'For each file: read it, work out what each side intended (git log/diff if unclear), edit it into one correct result with no conflict markers, and git add it.',
    'Run cheap quick checks (typecheck or nearby tests) if available.',
    `Do not commit, continue, abort or skip the ${kind}, and do not push. I will review and continue from Source Control.`,
    'Reply briefly: one line per file on how it was resolved, plus anything you were unsure about. No preamble.',
    '</ramu-context>',
  ].join('\n')
}

/**
 * Starts an agent thread in the same checkout that resolves the given conflicted files. Conflicts get their own thread,
 * so its transcript records what was decided and why; the thread is removed again when its first message fails.
 * Resolves with the host's task id to open.
 */
export async function startConflictThread(
  invoke: Invoke,
  input: ConflictWork & {
    computerId: string
    /** The project's id on the host. */
    projectId: string
    /** The isolated workspace the checkout lives in, or null for the project's own checkout. */
    workspaceId: string | null
    settings: AgentSettings
    /** Copy in the phone's language. */
    say: (text: string, values?: Record<string, string | number>) => string
  },
): Promise<string> {
  const { computerId, paths } = input
  const title =
    paths.length === 1 && !input.whole
      ? input.say('Resolve conflicts in {0}', { 0: paths[0]! })
      : input.say('Resolve {0} conflicts in {1}', { 0: input.kind, 1: input.repoName })
  const task = await invoke(computerId, 'tasks.create', {
    projectId: input.projectId,
    title,
    mode: input.workspaceId ? 'worktree' : 'current',
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  })
  try {
    await invoke(computerId, 'agent.start', task.id, conflictPrompt(input), input.settings, [], [])
    return task.id
  } catch (error) {
    await invoke(computerId, 'tasks.delete', task.id, false).catch(() => {})
    throw error
  }
}
