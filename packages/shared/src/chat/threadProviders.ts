import type { AgentProvider } from '../types'

/** One time an agent worked in a thread: a session's provider, or a provider a session handed off from. */
export interface ProviderUse {
  provider: AgentProvider
  at: number
}

/** How many agents a thread row shows: the one leading now and the latest two before it. */
export const PROVIDER_STACK_LIMIT = 3

/**
 * Every agent that has worked in a thread, oldest first by when each last worked, with the one leading it now last.
 * A model switch to another provider and a teammate from another provider both add one, so a row can show the
 * thread's whole cast instead of a single mark that a handoff would make wrong.
 */
export function threadProviders(uses: readonly ProviderUse[], current: AgentProvider | null): AgentProvider[] {
  const last = new Map<AgentProvider, number>()
  for (const use of uses) last.set(use.provider, Math.max(last.get(use.provider) ?? -Infinity, use.at))
  const earlier = [...last]
    .filter(([provider]) => provider !== current)
    .sort((a, b) => a[1] - b[1])
    .map(([provider]) => provider)
  return current ? [...earlier, current] : earlier
}

/** The part of a thread's agents a row has room for, the leading one last. */
export function providerStack(providers: readonly AgentProvider[]): AgentProvider[] {
  return providers.slice(-PROVIDER_STACK_LIMIT)
}
