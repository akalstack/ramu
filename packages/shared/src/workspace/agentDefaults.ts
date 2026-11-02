import type { AgentProvider, AgentSettings, ReasoningEffort } from '../types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'

export type DraftModelChoice = Pick<AgentSettings, 'provider' | 'model' | 'effort' | 'accountId' | 'serviceTier'>
export interface AgentDraftChoice {
  version: 1
  /** Only a person's explicit picker choice is stored here; repository defaults remain live. */
  selection?: DraftModelChoice
  behavior?: Pick<AgentSettings, 'access' | 'autoFallback'>
}
export interface ProjectAgentDefaults {
  status: 'none' | 'ready' | 'unavailable' | 'invalid'
  source?: 'ramu.json' | '.ramu/config.json'
  requested?: { provider?: string; model?: string }
  selection?: Pick<AgentSettings, 'provider' | 'model' | 'effort'>
  reason?: 'provider' | 'model' | 'catalog'
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))
const efforts: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Unknown metadata is never treated as permission to replace a saved explicit choice. */
export function parseAgentDraft(value: unknown): AgentDraftChoice | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !keys(value, ['version', 'selection', 'behavior', 'at']) ||
    (value.at !== undefined && (typeof value.at !== 'number' || !Number.isFinite(value.at)))
  )
    return null
  const selection = value.selection
  if (
    selection !== undefined &&
    (!record(selection) ||
      !keys(selection, ['provider', 'model', 'effort', 'accountId', 'serviceTier']) ||
      !AGENT_PROVIDERS.includes(selection.provider as AgentProvider) ||
      typeof selection.model !== 'string' ||
      selection.model.length > 200 ||
      (selection.effort !== null && !efforts.includes(selection.effort as ReasoningEffort)) ||
      (selection.accountId !== undefined &&
        (typeof selection.accountId !== 'string' || !selection.accountId || selection.accountId.length > 200)) ||
      (selection.serviceTier !== undefined && !['standard', 'fast'].includes(selection.serviceTier as string)))
  )
    return null
  const behavior = value.behavior
  if (
    behavior !== undefined &&
    (!record(behavior) ||
      !keys(behavior, ['access', 'autoFallback']) ||
      !['edits', 'auto', 'full'].includes(behavior.access as string) ||
      typeof behavior.autoFallback !== 'boolean')
  )
    return null
  return {
    version: 1,
    ...(selection ? { selection: { ...selection } as unknown as DraftModelChoice } : {}),
    ...(behavior ? { behavior: { ...behavior } as AgentDraftChoice['behavior'] } : {}),
  }
}
export function modelChoice(settings: AgentSettings): DraftModelChoice {
  return {
    provider: settings.provider,
    model: settings.model,
    effort: settings.effort,
    ...(settings.accountId ? { accountId: settings.accountId } : {}),
    ...(settings.serviceTier ? { serviceTier: settings.serviceTier } : {}),
  }
}
export function agentSettingsForDraft(
  base: AgentSettings,
  defaults: ProjectAgentDefaults | undefined,
  draft: AgentDraftChoice,
): AgentSettings {
  const selection: DraftModelChoice | undefined =
    draft.selection ?? (defaults?.status === 'ready' ? defaults.selection : undefined)
  return {
    ...base,
    ...(selection
      ? {
          ...selection,
          accountId: draft.selection
            ? selection.accountId
            : selection.provider === base.provider
              ? base.accountId
              : undefined,
          serviceTier: selection.serviceTier ?? 'standard',
        }
      : {}),
    ...draft.behavior,
  }
}
/**
 * Auto routing picks the project after the draft was composed, so the destination's repository defaults apply
 * with the same precedence as a manual pick. `undefined` defaults means an older host without them. Null means
 * the destination's defaults cannot be used and the person must review the model in that project first.
 */
export function routedAgentSettings(
  base: AgentSettings,
  defaults: ProjectAgentDefaults | undefined,
  draft: AgentDraftChoice,
): AgentSettings | null {
  if (!draft.selection && (defaults?.status === 'unavailable' || defaults?.status === 'invalid')) return null
  return agentSettingsForDraft(base, defaults, draft)
}
/** Behavior-only edits do not accidentally pin an inherited model. */
export function editAgentDraft(
  previous: AgentDraftChoice,
  current: AgentSettings,
  next: AgentSettings,
): AgentDraftChoice {
  const behaviorChanged = current.access !== next.access || current.autoFallback !== next.autoFallback
  const modelChanged = JSON.stringify(modelChoice(current)) !== JSON.stringify(modelChoice(next))
  return {
    version: 1,
    ...(previous.selection ? { selection: previous.selection } : {}),
    ...(previous.behavior ? { behavior: previous.behavior } : {}),
    ...(modelChanged || !behaviorChanged ? { selection: modelChoice(next) } : {}),
    behavior: { access: next.access, autoFallback: next.autoFallback },
  }
}
