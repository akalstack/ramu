import { useMemo } from 'react'
import type { RoutingCandidate } from '@ramu/shared/workspace/projectRouting'
import { useComputers } from './computers'
import { useWorkspacesOf } from './workspace'

/** Where a routing id points: a project on another connected host. */
export interface RouteTarget {
  hostId: string
  projectId: string
  name: string
  hostName?: string
}

/**
 * Projects on the other connected hosts, for Auto to consider beside this host's. Their routing ids are local to this
 * request; only names, aliases, descriptions and host names are sent.
 */
export function useOtherHostTargets(hostId: string, enabled: boolean) {
  const computers = useComputers()
  const others = useMemo(
    () =>
      enabled
        ? (computers?.computers ?? []).filter((computer) => computer.id !== hostId && computer.status === 'connected')
        : [],
    [computers, hostId, enabled],
  )
  const stores = useWorkspacesOf(others.map((computer) => computer.id))
  return useMemo(() => {
    const targets = new Map<string, RouteTarget>()
    const candidates: RoutingCandidate[] = []
    others.forEach((computer, index) => {
      for (const project of stores[index]?.projects ?? []) {
        if (candidates.length >= 40) return
        const id = `host${index}:${project.id}`
        targets.set(id, { hostId: computer.id, projectId: project.id, name: project.name, hostName: computer.name })
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
  }, [others, stores])
}
