import type { AgentSettings, StartedThread } from '@ramu/shared/types'
import { splitThreadPrompt, type RoutingCandidate } from '@ramu/shared/workspace/projectRouting'

/** One thread of a split prompt, as the person reviews it on the phone before anything starts. */
export interface SplitRow {
  key: string
  computerId: string
  /** The host's own project id, without the phone's host prefix. */
  projectId: string
  label: string
  title: string
  brief: string
}

export interface SplitDraft {
  version: 1
  original: string
  contract: string
  rows: SplitRow[]
  settings: AgentSettings
}

export interface RouteTarget {
  computerId: string
  projectId: string
  name: string
  hostName: string
  description?: string
}

export const splitDraftKey = (host: string) => `${host}:new:split-draft`

export function readSplitDraft(value: string | undefined): SplitDraft | null {
  try {
    const draft = JSON.parse(value ?? 'null') as SplitDraft | null
    return draft?.version === 1 && Array.isArray(draft.rows) && draft.rows.length ? draft : null
  } catch {
    return null
  }
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

type Invoke = (computerId: string, method: 'threads.startGroup', ...args: unknown[]) => Promise<unknown>

/** Starts every reviewed row as one group across hosts; each host starts its own rows, and failures stay per row. */
export async function startSplit(
  draft: SplitDraft,
  invoke: Invoke,
  groupId: string,
): Promise<(StartedThread & { computerId: string })[]> {
  const together = draft.rows.map((row) => row.title)
  const byHost = new Map<string, SplitRow[]>()
  for (const row of draft.rows) byHost.set(row.computerId, [...(byHost.get(row.computerId) ?? []), row])
  const results = await Promise.all(
    [...byHost].map(async ([computerId, rows]) => {
      try {
        const started = (await invoke(
          computerId,
          'threads.startGroup',
          {
            groupId,
            threads: rows.map((row) => ({
              projectId: row.projectId,
              title: row.title,
              prompt: splitThreadPrompt(row.brief, draft.contract, draft.original),
            })),
            together,
          },
          draft.settings,
        )) as StartedThread[]
        return started.map((entry) => ({ ...entry, computerId }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return rows.map((row) => ({ taskId: '', title: row.title, projectName: row.label, error: message, computerId }))
      }
    }),
  )
  return results.flat()
}
