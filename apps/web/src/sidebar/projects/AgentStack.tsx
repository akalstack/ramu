import type { Task } from '@ramu/shared/types'
import { providerStack } from '@ramu/shared/chat/threadProviders'
import { providerName } from '@ramu/shared/providers/providers'
import { ProviderIcon } from '../../models/ProviderIcon'

/**
 * The agents that have worked in a thread, the one leading now last and in its colours, earlier ones (a handoff, a
 * teammate) smaller and grey before it. A host that predates the list shows none.
 */
export function AgentStack({ task }: { task: Task }) {
  const agents = providerStack(task.providers ?? [])
  if (!agents.length) return null
  return (
    <span
      className="agent-stack inline-flex flex-none items-center gap-1"
      role="img"
      aria-label={agents.map((provider) => providerName(provider)).join(', ')}
    >
      {agents.map((provider, index) =>
        index < agents.length - 1 ? (
          <ProviderIcon key={provider} provider={provider} size={10} className="opacity-35 grayscale" />
        ) : (
          <ProviderIcon key={provider} provider={provider} size={12} className="opacity-60" />
        ),
      )}
    </span>
  )
}
