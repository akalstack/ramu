import type { AgentProvider, AgentSettings, ReasoningEffort } from '../types/agent'
import type { ModelPreferences } from '../types/settings'

/** One model and the login it runs on; no login means the provider's first one. */
export interface WorkModel {
  provider: AgentProvider
  model: string
  effort: ReasoningEffort | null
  accountId?: string
}

/**
 * The model one kind of Ramu's own work runs on, as a setting stores it. `thread` (also what `null` means) is the model
 * and login of the thread the work is for; `default` is the default step of the default model set.
 */
export type WorkModelChoice = WorkModel | { use: 'default' | 'thread' } | null

/** The default step of the default model set, or null when there is none. */
export function defaultWorkModel(models: ModelPreferences | null | undefined): WorkModel | null {
  const step = models?.sets
    .find((set) => set.id === models.defaultSetId)
    ?.steps.find((entry) => entry.id === models.defaultStepId)
  return step ? { provider: step.provider, model: step.model, effort: step.effort } : null
}

/** A thread's model and login as work for that thread names it, before the thread exists. */
export function threadWorkModel(
  settings: Pick<AgentSettings, 'provider' | 'model' | 'effort' | 'accountId'>,
): WorkModel {
  return {
    provider: settings.provider,
    model: settings.model,
    effort: settings.effort,
    ...(settings.accountId ? { accountId: settings.accountId } : {}),
  }
}

/**
 * The model work runs on. `thread` uses the thread's model and login, and falls back to the default model where the work
 * has no thread. `default` uses the default model, and falls back to the thread's where no default is set. Null only
 * when neither is known.
 */
export function resolveWorkModel(
  choice: WorkModelChoice,
  context: {
    thread?: Pick<AgentSettings, 'provider' | 'model' | 'effort' | 'accountId'> | null
    models?: ModelPreferences | null
  },
): WorkModel | null {
  const use = choice ? ('use' in choice ? choice.use : null) : 'thread'
  if (!use) return choice as WorkModel
  const thread = context.thread
    ? {
        provider: context.thread.provider,
        model: context.thread.model,
        effort: context.thread.effort,
        ...(context.thread.accountId ? { accountId: context.thread.accountId } : {}),
      }
    : null
  const fallback = defaultWorkModel(context.models)
  return use === 'thread' ? (thread ?? fallback) : (fallback ?? thread)
}

/**
 * Settings for work that starts from `base` (the thread's, or the defaults) and runs on `model`. The base's login stays
 * only for the same provider and when the choice names none: another provider's login is not this one's.
 */
export function withWorkModel<T extends AgentSettings>(base: T, model: WorkModel | null): T {
  if (!model) return base
  const accountId = model.accountId ?? (model.provider === base.provider ? base.accountId : undefined)
  const next = { ...base, provider: model.provider, model: model.model, effort: model.effort }
  if (accountId) next.accountId = accountId
  else delete next.accountId
  return next
}
