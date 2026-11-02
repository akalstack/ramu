import type { HandlerContext, MethodTable } from './types'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
  type AppPreferences,
  type ModelPreferences,
} from '@ramu/shared/types'

/** Lock key for work inside one checkout directory. */
const checkoutKey = (cwd: string) => `checkout:${cwd}`

/** Lock key for work that touches a repository's shared refs. */
export const repoKey = (ctx: HandlerContext, repoId: string) => `repo:${ctx.workspace.getRepository(repoId).root}`

/** Serialize on a repository's shared refs. */
export const lockRepo = <T>(ctx: HandlerContext, repoId: string, fn: () => Promise<T>) =>
  ctx.lock.run(repoKey(ctx, repoId), fn)

/** Serialize on a single checkout. */
export const lockCheckout = <T>(ctx: HandlerContext, cwd: string, fn: () => Promise<T>) =>
  ctx.lock.run(checkoutKey(cwd), fn)

/** Serialize on several checkouts at once (a chat can span more than one). */
export const lockCheckouts = <T>(ctx: HandlerContext, cwds: string[], fn: () => Promise<T>) =>
  ctx.lock.runMany(cwds.map(checkoutKey), fn)

/** Serialize on a checkout and its repository, for Git operations that rewrite refs. */
export const lockCheckoutAndRepo = <T>(ctx: HandlerContext, cwd: string, repoId: string, fn: () => Promise<T>) =>
  ctx.lock.runMany([checkoutKey(cwd), repoKey(ctx, repoId)], fn)

/** Serialize on the checkouts a chat session can write to. */
export const lockSession = <T>(ctx: HandlerContext, sessionId: string, fn: () => Promise<T>) =>
  lockCheckouts(ctx, ctx.agents.get(sessionId).covers, fn)

/** Resolve a task's Git checkout and run `fn` holding the checkout and repository locks. */
export const gitExclusive = <T>(
  ctx: HandlerContext,
  taskId: string,
  repoId: string,
  fn: (cwd: string) => Promise<T>,
) => {
  const cwd = ctx.gitCwdOf(taskId, repoId)
  return lockCheckoutAndRepo(ctx, cwd, repoId, () => fn(cwd))
}

/** Operations that would race a running agent refuse to start while one writes in this checkout. */
export const assertNoActiveWriter = (ctx: HandlerContext, cwd: string, message: string) => {
  if (ctx.agents.activeWriter([cwd])) throw new Error(message)
}

/** Services that may be absent at runtime fail with one consistent message. */
export const need = <T>(service: T | undefined): T => {
  if (!service) throw new Error('Memory is unavailable')
  return service
}

/** Joins handler-group tables into one, rejecting a method registered twice. */
export const mergeMethods = (...tables: MethodTable[]): MethodTable => {
  const merged: MethodTable = {}
  for (const table of tables)
    for (const [name, method] of Object.entries(table)) {
      if (Object.hasOwn(merged, name)) throw new Error(`Duplicate RPC method ${name}`)
      merged[name] = method
    }
  return merged
}

/**
 * The model that writes commit messages and pull request drafts: the one chosen in Settings → Git, else the default
 * step of the default model set, else `base` (the thread's own settings, or the defaults).
 */
export function writingSettings(
  workspace: Pick<HandlerContext['workspace'], 'getAppState'>,
  prefs: Partial<AppPreferences>,
  base: AgentSettings = DEFAULT_AGENT_SETTINGS,
): AgentSettings | null {
  const modelPrefs = workspace.getAppState<ModelPreferences | null>('model-preferences', null)
  const defaultStep = modelPrefs?.sets
    .find((set) => set.id === modelPrefs.defaultSetId)
    ?.steps.find((step) => step.id === modelPrefs.defaultStepId)
  const chosen = prefs.commitModel ?? defaultStep
  if (!chosen) return base === DEFAULT_AGENT_SETTINGS ? null : base
  return {
    ...base,
    provider: chosen.provider,
    model: chosen.model,
    effort: chosen.effort,
    accountId: chosen.provider === base.provider ? base.accountId : undefined,
    serviceTier: undefined,
  }
}
