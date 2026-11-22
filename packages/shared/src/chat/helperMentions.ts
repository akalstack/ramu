// A message that starts with `@handle` asks the main agent to hand it to a helper: a model, a custom agent or an
// ability (`@images`). Shared by the desktop and phone composers and the server, so all three read a mention the same way.
import type { AgentModel } from '../types'
import { customAgentHandle, type CustomAgent } from '../customAgents'
import type { DraftMention } from './composerDraft'
import { ABILITY_HANDLES, type AbilityHandle } from '../providers/abilities'

/** The model each `@ability` handle starts a helper on, on this host (from `abilities.mentionModels`). */
export type AbilityModels = Partial<Record<AbilityHandle, AgentModel>>

/** The handle a model is addressed by: its display name, as the model menu shows it, in lower case with dashes. */
export const modelHandle = (model: Pick<AgentModel, 'id' | 'name'>) => customAgentHandle(model.name || model.id)

export type MentionTarget =
  | { kind: 'model'; model: AgentModel; body: string }
  | { kind: 'agent'; agent: CustomAgent; body: string }
  | { kind: 'ability'; handle: AbilityHandle; model: AgentModel; body: string }

/** The helper a message that starts with `@handle` and has text after it asks for, or null for a plain message. */
export function resolveMention(
  text: string,
  models: readonly AgentModel[],
  agents: readonly CustomAgent[] = [],
  byAbility: AbilityModels = {},
): MentionTarget | null {
  const match = /^@(\S+)\s+([\s\S]+)$/.exec(text.trim())
  return match ? resolveHandle(match[1]!, match[2]!.trim(), models, agents, byAbility) : null
}

/** Everyone a message can start with, for drawing `@handle` as who it is: custom agents, abilities, then models. */
export function draftMentions(
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
  for (const agent of agents)
    add({
      handle: customAgentHandle(agent.name),
      label: agent.name,
      ...(agent.model ? { provider: agent.model.provider } : {}),
    })
  for (const [handle, model] of Object.entries(byAbility) as [AbilityHandle, AgentModel][])
    add({ handle, label: `${handle} · ${model.name || model.id}`, provider: model.provider })
  // A current model before a legacy one of the same name, matching how a message is read.
  for (const model of [...models].sort((a, b) => Number(!!a.isLegacy) - Number(!!b.isLegacy)))
    add({ handle: modelHandle(model), label: model.name || model.id, provider: model.provider })
  return mentions
}

function resolveHandle(
  raw: string,
  body: string,
  models: readonly AgentModel[],
  agents: readonly CustomAgent[],
  byAbility: AbilityModels,
): MentionTarget | null {
  const handle = raw.toLowerCase()
  const agent = agents.find((entry) => customAgentHandle(entry.name) === handle)
  if (agent) return { kind: 'agent', agent, body }
  const viaAbility = Object.hasOwn(byAbility, handle) ? byAbility[handle as AbilityHandle] : undefined
  if (viaAbility) return { kind: 'ability', handle: handle as AbilityHandle, model: viaAbility, body }
  const model =
    models.find((entry) => !entry.isLegacy && modelHandle(entry) === handle) ??
    models.find((entry) => modelHandle(entry) === handle || entry.id.toLowerCase() === handle)
  return model ? { kind: 'model', model, body } : null
}

/**
 * What the main agent is told about a message addressed to a helper: which helper to start with ramu_agent, so the
 * person gets a second model, a custom agent or an ability without setting one up.
 */
export function mentionInstruction(target: MentionTarget): string {
  const call =
    target.kind === 'agent'
      ? `type "${customAgentHandle(target.agent.name)}"`
      : target.kind === 'ability'
        ? `needs ["${ABILITY_HANDLES[target.handle]}"]`
        : `model "${modelHandle(target.model)}"`
  const role = target.kind === 'agent' ? '' : ' and role "review" unless the request asks for changes'
  return `The person addressed this message to a helper. Start one with ramu_agent, ${call}${role}, give it the request with the context it needs, then relay its report.`
}
