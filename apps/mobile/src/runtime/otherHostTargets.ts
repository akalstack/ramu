import type { RoutingCandidate } from '@ramu/shared/workspace/projectRouting'

/** A project on another online host, for Home's Auto to weigh beside the selected host's. */
export interface RouteTarget {
  computerId: string
  projectId: string
  name: string
  hostName: string
  description?: string
}

/**
 * Projects on the other online hosts, for Auto to weigh beside the selected host's. Ids are local to one request; only
 * names, aliases, descriptions and host names leave the phone.
 */
export function otherHostTargets(
  selected: string,
  computers: readonly { id: string; name: string; status: string }[],
  projects: readonly { id: string; computerId: string; name: string; aliases?: string[]; description?: string }[],
): { targets: Map<string, RouteTarget>; candidates: RoutingCandidate[] } {
  const targets = new Map<string, RouteTarget>()
  const candidates: RoutingCandidate[] = []
  computers
    .filter((computer) => computer.id !== selected && computer.status === 'online')
    .forEach((computer, index) => {
      for (const project of projects) {
        if (project.computerId !== computer.id || candidates.length >= 40) continue
        const projectId = project.id.slice(project.id.indexOf(':') + 1)
        const id = `host${index}:${projectId}`
        targets.set(id, {
          computerId: computer.id,
          projectId,
          name: project.name,
          hostName: computer.name,
          description: project.description,
        })
        candidates.push({
          id,
          name: project.name,
          host: computer.name,
          ...(project.aliases?.length ? { aliases: project.aliases } : {}),
          ...(project.description ? { description: project.description } : {}),
        })
      }
    })
  return { targets, candidates }
}
