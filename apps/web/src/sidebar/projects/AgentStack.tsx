import type { Task } from '@ramu/shared/types'
import { providerStack } from '@ramu/shared/chat/threadProviders'
import { providerName } from '@ramu/shared/providers/providers'
import { ProviderIcon } from '../../models/ProviderIcon'

/*
 * Each mark is 12px and the next one starts 7px later, so it covers the right 5px of the one before. Instead of a ring
 * painted in the row's colour, each covered mark has a circle cut out under the next one (its 6px radius plus a 1.5px
 * gap), so the gap shows whatever is behind the row: the sidebar, a hover or selected fill, in light and dark alike.
 */
const COVERED = '-mr-[5px] [mask-image:radial-gradient(circle_at_13px_50%,transparent_7.5px,#000_8px)]'

/**
 * The agents that have worked in a thread as an overlapping stack, oldest first, with the one leading now last: on top,
 * whole and in its colours, the earlier ones (a handoff, a teammate) grey and tucked behind it. Agents beyond the
 * stack's room show as "+N"; the label and tooltip name all of them. A host that predates the list shows none.
 */
export function AgentStack({ task }: { task: Task }) {
  const all = task.providers ?? []
  const agents = providerStack(all)
  if (!agents.length) return null
  const names = all.map((provider) => providerName(provider)).join(', ')
  const hidden = all.length - agents.length
  return (
    <span className="agent-stack inline-flex flex-none items-center" role="img" aria-label={names} title={names}>
      {hidden > 0 && <span className="mr-0.5 text-[10px] leading-3 text-muted-foreground tabular-nums">+{hidden}</span>}
      {agents.map((provider, index) =>
        index < agents.length - 1 ? (
          <span key={provider} className={`inline-flex ${COVERED}`}>
            <ProviderIcon provider={provider} size={12} className="opacity-35 grayscale" />
          </span>
        ) : (
          <ProviderIcon key={provider} provider={provider} size={12} className="opacity-60" />
        ),
      )}
    </span>
  )
}
