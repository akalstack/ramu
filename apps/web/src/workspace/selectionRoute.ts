// What "open this on that host" does. The selection is (host, destination): the host whose store is on screen and the
// thread, project or view inside it. Framework-free so the rules can be tested without React.
import type { HostDestination } from '@ramu/shared/hostOverview'
import type { ComputerStatus } from '@ramu/shared/types'
import type { WorkspaceApi } from './workspace'

/**
 * Selection stays in the shell. A host that is away still opens from this device's copy of it (`offlineCopy`), so its
 * threads can be read and answered through the outbox; one with no copy, or that refused this device, reports an
 * error without changing the active host.
 */
export function routeSelection({
  host,
  active,
  status,
  ready = true,
  offlineCopy = false,
}: {
  host: string
  active: string
  status: ComputerStatus | null
  ready?: boolean
  offlineCopy?: boolean
}): 'here' | 'switch' | 'unavailable' | 'pending' {
  if (!ready) return 'pending'
  if (host === active) return 'here'
  if (status === 'connected') return 'switch'
  return offlineCopy && canOpenOffline(status) ? 'switch' : 'unavailable'
}

/** A host that refused this device is not shown from its copy: what it holds is no longer this device's to read. */
export const canOpenOffline = (status: ComputerStatus | null) =>
  status === 'offline' || status === 'connecting' || status === 'paused'

/**
 * A thread or project may have been created elsewhere (a phone, another window), so a destination the store does not
 * hold yet waits for a re-read. One it already holds opens now and is brought up to date behind the switch.
 */
export const needsRefresh = (destination: HostDestination, store: Pick<WorkspaceApi, 'tasks' | 'projects'> | null) => {
  if (destination.kind === 'task') return !store?.tasks.some((task) => task.id === destination.taskId)
  if (destination.kind === 'project') return !store?.projects.some((project) => project.id === destination.projectId)
  return false
}

export type DestinationTarget = Pick<
  WorkspaceApi,
  'tasks' | 'openTask' | 'openView' | 'setSidebar' | 'openProject' | 'newTask'
>

/** Applies a destination to the store that owns it. Returns false when the thread is not on that host. */
export function applyDestination(
  ws: DestinationTarget,
  destination: HostDestination,
  { openSummary }: { openSummary(summaryId: string): void },
): boolean {
  switch (destination.kind) {
    case 'host':
      return true
    case 'task':
      if (!ws.tasks.some((task) => task.id === destination.taskId)) return false
      ws.openTask(destination.taskId)
      if (destination.sessionId)
        ws.openView(destination.taskId, {
          kind: 'agent',
          sessionId: destination.sessionId,
          ...(destination.requestId ? { focusRequestId: destination.requestId } : {}),
          // Scrolls to that place once, as a link to a message does.
          ...(destination.sourceSeq !== undefined
            ? { sourceSeq: destination.sourceSeq, sourceRequestId: crypto.randomUUID() }
            : {}),
        })
      return true
    case 'project':
      ws.setSidebar('projects')
      ws.openProject(destination.projectId)
      return true
    case 'new':
      ws.newTask(destination.projectId)
      return true
    case 'summary':
      openSummary(destination.summaryId)
      return true
    case 'inbox':
      ws.setSidebar('inbox')
      return true
  }
}
