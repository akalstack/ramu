// Who a message that starts with `@handle` goes to: a teammate already in the thread, or a model or custom agent that
// joins it as one. Shared by the desktop and phone composers so both route a message the same way.
import type { AgentModel, AgentSettings, AgentTask, TeammateMode } from '../types'
import type { CustomAgent } from '../customAgents'
import { namesTeammate, teammateHandle } from './agentTasks'
import type { DraftMention } from './composerDraft'
import type { AbilityHandle } from '../providers/abilities'

/** The model each `@ability` handle brings in on this host (from `abilities.teammateModels`). */
export type AbilityModels = Partial<Record<AbilityHandle, AgentModel>>

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
  byAbility: AbilityModels = {},
): MentionTarget | null {
  const match = /^@(\S+)\s+([\s\S]+)$/.exec(text.trim())
  return match ? resolveHandle(match[1]!, match[2]!.trim(), teammates, models, agents, byAbility) : null
}

/**
 * Who a draft is addressed to while it is still being written: a leading `@handle` and a space, with or without words
 * yet. The composer shows a new teammate's settings while this names a model or custom agent.
 */
export function draftMention(
  text: string,
  teammates: readonly AgentTask[],
  models: readonly AgentModel[],
  agents: readonly CustomAgent[] = [],
  byAbility: AbilityModels = {},
): MentionTarget | null {
  const match = /^@(\S+)\s([\s\S]*)$/.exec(text)
  return match ? resolveHandle(match[1]!, match[2]!.trim(), teammates, models, agents, byAbility) : null
}

/** Everyone a message can start with, for drawing `@handle` as who it is: teammates, custom agents, then models. */
export function draftMentions(
  teammates: readonly AgentTask[],
  models: readonly AgentModel[],
  agents: readonly CustomAgent[] = [],
  byAbility: AbilityModels = {},
): DraftMention[] {
  const seen = new Set<string>()
  const mentions: DraftMention[] = []
  const add = (mention: DraftMention) => {
    if (seen.has(mention.handle)) return
    seen.add(mention.handle)
    mentions.push(mention)
  }
  for (const task of teammates)
    add({
      handle: teammateHandle(task.name),
      label: task.name,
      ...(task.provider ? { provider: task.provider } : {}),
    })
  for (const agent of agents)
    add({
      handle: teammateHandle(agent.name),
      label: agent.name,
      ...(agent.model ? { provider: agent.model.provider } : {}),
    })
  for (const [handle, model] of Object.entries(byAbility) as [AbilityHandle, AgentModel][])
    add({ handle, label: `${handle} · ${model.name || model.id}`, provider: model.provider })
  // A current model before a legacy one of the same name, matching how a message is routed.
  for (const model of [...models].sort((a, b) => Number(!!a.isLegacy) - Number(!!b.isLegacy)))
    add({ handle: modelHandle(model), label: model.name || model.id, provider: model.provider })
  return mentions
}

function resolveHandle(
  raw: string,
  body: string,
  teammates: readonly AgentTask[],
  models: readonly AgentModel[],
  agents: readonly CustomAgent[],
  byAbility: AbilityModels,
): MentionTarget | null {
  const handle = raw.toLowerCase()
  if (handle === 'teammate') return teammates.length === 1 ? { kind: 'teammate', task: teammates[0]!, body } : null
  const task = teammates.find((entry) => namesTeammate(handle, entry.name))
  if (task) return { kind: 'teammate', task, body }
  const agent = agents.find((entry) => teammateHandle(entry.name) === handle)
  if (agent) return { kind: 'agent', agent, body }
  // `@images` and the other ability handles join as the model this host picks for that ability.
  const viaAbility = Object.hasOwn(byAbility, handle) ? byAbility[handle as AbilityHandle] : undefined
  if (viaAbility) return { kind: 'model', model: viaAbility, body }
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

/**
 * A model or custom agent a draft brings in, as it starts out: the thread's settings on that model, reviewing; or a
 * custom agent's recipe. `key` tells one target from another, so changes made in the composer stay with that target.
 */
export function joiningTeammate(
  target: Extract<MentionTarget, { kind: 'model' | 'agent' }>,
  base: AgentSettings,
): { key: string; name: string; settings: AgentSettings; mode: TeammateMode } {
  if (target.kind === 'model')
    return {
      key: `model:${modelHandle(target.model)}`,
      name: target.model.name || target.model.id,
      settings: teammateSettings(base, target.model),
      mode: 'review',
    }
  const agent = target.agent
  return {
    key: `agent:${agent.id}`,
    name: agent.name,
    settings: agent.model
      ? teammateSettings(base, {
          provider: agent.model.provider,
          id: agent.model.model,
          defaultEffort: agent.model.effort ?? null,
        })
      : base,
    mode: agent.readOnly ? 'review' : 'take-over',
  }
}
