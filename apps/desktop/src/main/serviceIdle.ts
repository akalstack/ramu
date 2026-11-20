import type { ResourceSnapshot } from '@ramu/shared/resources'

/**
 * Whether the background service owns nothing a restart would end: no agent working or waiting for an answer, and no
 * terminal, background command or test device. A restart closes all of those, so anything live keeps the service where
 * it is. It reads only what every service already answers, so it works against the release being replaced, and a
 * reading it cannot take counts as busy.
 */
export async function serviceIsIdle(read: {
  counts: () => Promise<{ running: number; needsInput: number }>
  resources: () => Promise<ResourceSnapshot>
}): Promise<boolean> {
  try {
    const [counts, resources] = await Promise.all([read.counts(), read.resources()])
    return counts.running + counts.needsInput === 0 && resources.threads.every((thread) => !thread.items.length)
  } catch {
    return false
  }
}
