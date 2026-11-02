import { parseForgeRemote } from './forgeRemote'
import type { AgentEvent, AgentSettings, Project, ThreadOrigin } from './types'

// Continue on another host: the person's device calls each host directly, so a paired host never clones or reads a
// transcript. The conversation travels; files stay and the other host starts from pushed commits.

export interface ContinuationRepo {
  remoteUrl: string
  repoName: string
  branch: string
  commit: string
  /** Files changed and not committed; they stay on this host. */
  dirtyFiles: number
  /** Commits not on the remote; they stay on this host. */
  unpushed: number
  /** Whether the branch exists on the remote; if not, the other host starts from the default branch. */
  pushed: boolean
}

export interface ContinuationPackage {
  title: string
  running: boolean
  /** The redacted transcript and request, bounded to what a thread start accepts. */
  prompt: string
  settings: AgentSettings
  queued: number
  repo: ContinuationRepo | null
  problem: 'no-agent' | 'no-remote' | 'several-repositories' | null
}

export interface ContinuationMatch {
  projectId: string
  name: string
  /** A name match is offered, but a person must choose it: names differ between machines. */
  by: 'remote' | 'name'
}

export interface ContinuationStart {
  key: string
  from: { hostId: string; hostName: string; taskId: string; title: string }
  projectId: string
  branch: string
  prompt: string
  note?: string
  settings: AgentSettings
}

export interface ContinuedEvent {
  hostId: string
  host: string
  taskId: string
  title: string
}

/** Compares remotes by what they point at, so `git@host:a/b.git` and `https://host/a/b` are one repository. */
export function remoteKey(url: string): string {
  const parsed = parseForgeRemote(url)
  if (parsed) return `${parsed.origin}/${parsed.owner}/${parsed.repo}`.toLowerCase()
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

export function matchProject(
  repo: Pick<ContinuationRepo, 'remoteUrl' | 'repoName'>,
  projects: readonly (Pick<Project, 'id' | 'name'> & { remotes: readonly string[] })[],
): ContinuationMatch | null {
  const wanted = remoteKey(repo.remoteUrl)
  const exact = projects.find((project) => project.remotes.some((remote) => remoteKey(remote) === wanted))
  if (exact) return { projectId: exact.id, name: exact.name, by: 'remote' }
  const named = projects.find((project) => project.name.toLowerCase() === repo.repoName.toLowerCase())
  return named ? { projectId: named.id, name: named.name, by: 'name' } : null
}

const PREFIX = 'continued:'

/** The group id of a continued thread names its original, so clients can link the two without a schema change. */
export const continuationGroup = (hostId: string, taskId: string, key: string) =>
  `${PREFIX}${JSON.stringify([hostId, taskId, key])}`

export function continuedFrom(origin: Pick<ThreadOrigin, 'groupId'> | null | undefined) {
  if (!origin?.groupId.startsWith(PREFIX)) return null
  try {
    const [hostId, taskId] = JSON.parse(origin.groupId.slice(PREFIX.length)) as [string, string]
    return { hostId, taskId }
  } catch {
    return null
  }
}

/** What Bring back carries: the latest reply, labelled so the agent knows where it came from. */
export function latestReply(events: readonly { event: AgentEvent }[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const { event } = events[index]!
    if (event.kind === 'text' && !event.agentId && event.text.trim()) return event.text
  }
  return null
}

export const broughtBack = (host: string, reply: string) =>
  `Result from the continued thread on ${host}. It worked in its own checkout there:\n\n${reply}`

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

/** Starts on the other host, then tells the original. A lost label leaves the started thread standing; it is retried. */
export async function continueOnHost(
  invoke: Invoke,
  target: { id: string; name: string },
  start: ContinuationStart,
): Promise<{ taskId: string }> {
  const started = (await invoke(target.id, 'threads.continueHere', start)) as { taskId: string; error?: string }
  if (!started.taskId) throw new Error(started.error ?? 'That host could not start the thread.')
  const event: ContinuedEvent = {
    hostId: target.id,
    host: target.name,
    taskId: started.taskId,
    title: start.from.title,
  }
  const note = () => invoke(start.from.hostId, 'threads.noteContinued', start.from.taskId, event)
  await note().catch(() => note().catch(() => {}))
  return started
}

/** Sets a repository up on the other host through its own clone, with its own credentials. */
export async function cloneForContinuation(
  invoke: Invoke,
  hostId: string,
  repo: Pick<ContinuationRepo, 'remoteUrl' | 'repoName'>,
  parent: string,
  cloneId: string,
) {
  const path = (await invoke(hostId, 'folders.clone', parent, repo.repoName, repo.remoteUrl, cloneId)) as string
  const { project } = (await invoke(hostId, 'folders.addProject', path)) as { project: Project }
  return project
}
