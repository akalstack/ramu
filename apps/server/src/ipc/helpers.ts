import { resolveWorkModel, withWorkModel } from '@ramu/shared/providers/workModel'
import { removeAgentCredits } from '@ramu/shared/workspace/agentCredits'
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

/** Commit messages and pull requests as Ramu records them: without agent credits unless the person keeps them. */
export function withoutAgentCredits(ctx: Pick<HandlerContext, 'storedPreferences'>, text: string): string {
  return ctx.storedPreferences().removeAgentCredits === false ? text : removeAgentCredits(text)
}

/**
 * The model that writes commit messages and pull request drafts: the one chosen in Settings › Models (Writing model),
 * which by default is the thread's own model and login, so the work runs where the thread already has room.
 */
export function writingSettings(
  workspace: Pick<HandlerContext['workspace'], 'getAppState'>,
  prefs: Partial<AppPreferences>,
  thread?: AgentSettings | null,
): AgentSettings | null {
  const models = workspace.getAppState<ModelPreferences | null>('model-preferences', null)
  const model = resolveWorkModel(prefs.commitModel ?? null, { thread, models })
  if (!model) return thread ?? null
  const base = thread ?? DEFAULT_AGENT_SETTINGS
  const settings = withWorkModel(base, model)
  // A fast tier belongs to the thread's own model; another model runs at its standard one.
  return settings.provider === base.provider && settings.model === base.model
    ? settings
    : { ...settings, serviceTier: undefined }
}
