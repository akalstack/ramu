// Who a message that starts with `@handle` goes to: a teammate already in the thread, or a model or custom agent that
// joins it as one. Shared by the desktop and phone composers so both route a message the same way.
import type { AgentModel, AgentSettings, AgentTask } from '../types'
import type { CustomAgent } from '../customAgents'
import { namesTeammate, teammateHandle } from './agentTasks'

/** The handle a model is addressed by: its display name, as the model menu shows it, in lower case with dashes. */
export const modelHandle = (model: Pick<AgentModel, 'id' | 'name'>) => teammateHandle(model.name || model.id)

export type MentionTarget =
  | { kind: 'teammate'; task: AgentTask; body: string }
  | { kind: 'model'; model: AgentModel; body: string }
  | { kind: 'agent'; agent: CustomAgent; body: string }

/**
 * The target of a message that starts with `@handle` and has text after it, or null for a message to the lead.
 * A teammate already here wins over a model of the same name, so `@opus-5.5` keeps talking to the one that joined;
 * plain `@teammate` works while there is exactly one.
 */
export function resolveMention(
  text: string,
  teammates: readonly AgentTask[],
  models: readonly AgentModel[],
  agents: readonly CustomAgent[] = [],
): MentionTarget | null {
  const match = /^@(\S+)\s+([\s\S]+)$/.exec(text.trim())
  if (!match) return null
  const handle = match[1]!.toLowerCase()
  const body = match[2]!.trim()
  if (handle === 'teammate') return teammates.length === 1 ? { kind: 'teammate', task: teammates[0]!, body } : null
  const task = teammates.find((entry) => namesTeammate(handle, entry.name))
  if (task) return { kind: 'teammate', task, body }
  const agent = agents.find((entry) => teammateHandle(entry.name) === handle)
  if (agent) return { kind: 'agent', agent, body }
  const model =
    models.find((entry) => !entry.isLegacy && modelHandle(entry) === handle) ??
    models.find((entry) => modelHandle(entry) === handle || entry.id.toLowerCase() === handle)
  return model ? { kind: 'model', model, body } : null
}

/**
 * The note a teammate gets before its next message: what the thread said since it last took part, and which files
 * changed. Empty when nothing happened in between.
 */
export function teammateCatchUp(transcript: string, files: readonly string[]): string {
  if (!transcript.trim() && !files.length) return ''
  return [
    '<thread-catch-up>',
    'Since you last took part in this thread:',
    ...(transcript.trim() ? ['', transcript.trim()] : []),
    ...(files.length ? ['', `Files changed: ${files.join(', ')}`] : []),
    '</thread-catch-up>',
    '',
    '',
  ].join('\n')
}

/**
 * Settings for a model joining as a teammate: the thread's own (access and fallback), on that model at its default
 * effort. A login or fast mode belongs to the thread's provider, so it carries over only to the same one.
 */
export function teammateSettings(
  base: AgentSettings,
  model: Pick<AgentModel, 'provider' | 'id' | 'defaultEffort'>,
): AgentSettings {
  const same = model.provider === base.provider
  return {
    ...base,
    provider: model.provider,
    model: model.id,
    effort: model.defaultEffort,
    serviceTier: same ? base.serviceTier : 'standard',
    accountId: same ? base.accountId : undefined,
  }
}
