// Tools reach other hosts without a desktop app open: this host offers the tools it keeps on other hosts to each host
// it has added for agents, over that pairing. The other host keeps only what is meant for it, waiting for a review.
import { z } from 'zod'
import type { AgentHostSummary } from '@ramu/shared/types'
import { recogniseHost, toolOffer, type ToolSources } from './toolSync'

/** Often enough that a host that was asleep gets the tools soon after it wakes. */
const EVERY_MS = 30 * 60_000
/** Changes come in bursts (a plugin installs its servers and skills); one offer follows the last of them. */
const SETTLE_MS = 5_000

const answer = z.object({
  hostId: z.string().min(1).max(200),
  hostName: z.string().max(200),
  received: z.number().int().nonnegative(),
})

export interface ToolDeliveryHosts {
  list(): AgentHostSummary[]
  invoke(id: string, method: string, args: unknown[]): Promise<unknown>
}

export function startToolDelivery(sources: ToolSources, hosts: ToolDeliveryHosts, changed: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  const run = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      const offer = toolOffer(sources)
      if (!offer) return
      for (const host of hosts.list()) {
        try {
          const reply = answer.parse(await hosts.invoke(host.id, 'hostTools.offer', [offer]))
          if (recogniseHost(sources.workspace, reply)) changed()
        } catch {
          // Asleep, offline, or Agents turned off for this host there: the next offer tries again.
        }
      }
    } finally {
      running = false
      if (again) {
        again = false
        schedule()
      }
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), SETTLE_MS)
    timer.unref?.()
  }
  const interval = setInterval(() => void run(), EVERY_MS)
  interval.unref?.()
  schedule()
  return {
    /** Something that changes what travels changed here: offer again once it settles. */
    changed: schedule,
    stop: () => {
      clearTimeout(timer)
      clearInterval(interval)
    },
  }
}
