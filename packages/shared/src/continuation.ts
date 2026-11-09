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
  /** The Git author email the thread commits as here; hosts are compared by it, since identity names are per host. */
  gitEmail?: string | null
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

const PLATFORM_WORDS: Record<string, string[]> = {
  linux: ['linux', 'ubuntu', 'debian', 'fedora'],
  darwin: ['mac', 'macos', 'darwin', 'osx'],
  win32: ['windows'],
}

export interface HostChoice {
  id: string
  name: string
  resources?: import('./resources').HostResources | null
}

/**
 * Hosts in the order a person would pick them: one whose platform the latest request names is suggested, then more
 * memory free first. A plain word match, no model call; a host that reports nothing is never suggested.
 */
export function rankHosts<T extends HostChoice>(hosts: readonly T[], request: string) {
  const words = new Set(request.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const ranked = hosts.map((host) => {
    const platform = host.resources?.platform
    const described = (host.resources?.description?.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length > 2,
    )
    const suggested =
      (!!platform && (PLATFORM_WORDS[platform] ?? []).some((word) => words.has(word))) ||
      described.some((word) => words.has(word))
    const low = !!host.resources?.low
    return { host, suggested, low, free: host.resources?.memory?.availableBytes ?? -1 }
  })
  return ranked.sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.free - a.free)
}

/** Hosts one continuation may target; each gets its own thread and branch, and one failing never stops the others. */
export const CONTINUE_HOSTS = 4

export interface TargetPlan {
  match: ContinuationMatch | null
  settings: AgentSettings
  parent: string
  /** The Git author email the thread would commit as on the target, by its own identities. */
  gitEmail?: string | null
}

/** Reads the package once, then asks every target what it would do. A target that cannot answer says why. */
export async function prepareTargets(
  invoke: Invoke,
  from: { hostId: string; taskId: string },
  targets: readonly string[],
) {
  const pack = (await invoke(from.hostId, 'threads.continuationPackage', from.taskId)) as ContinuationPackage
  const plans = await Promise.all(
    targets.map(async (id): Promise<[string, TargetPlan | { error: string }]> => {
      if (!pack.repo) return [id, { match: null, settings: pack.settings, parent: '' }]
      try {
        return [id, (await invoke(id, 'threads.prepareContinuation', pack.repo, pack.settings)) as TargetPlan]
      } catch (error) {
        return [id, { error: error instanceof Error ? error.message : String(error) }]
      }
    }),
  )
  return { pack, plans: Object.fromEntries(plans) }
}

/** Starts on each chosen host in parallel, with a key per host so a retry finds the same thread there. */
export async function startTargets(
  invoke: Invoke,
  input: {
    pack: ContinuationPackage
    from: ContinuationStart['from']
    targets: readonly { id: string; name: string; plan: TargetPlan; useNamed: boolean; key: string; cloneId: string }[]
    note: string
  },
): Promise<Record<string, string | null>> {
  const repo = input.pack.repo
  if (!repo) throw new Error('This thread has nothing another host can start from.')
  const outcomes = await Promise.all(
    input.targets.map(async (target): Promise<[string, string | null]> => {
      try {
        const match = target.plan.match
        const existing = match && (match.by === 'remote' || target.useNamed) ? match.projectId : null
        const projectId =
          existing ?? (await cloneForContinuation(invoke, target.id, repo, target.plan.parent, target.cloneId)).id
        await continueOnHost(
          invoke,
          { id: target.id, name: target.name },
          {
            key: target.key,
            from: input.from,
            projectId,
            branch: repo.pushed ? repo.branch : '',
            prompt: input.pack.prompt,
            ...(input.note.trim() ? { note: input.note.trim() } : {}),
            settings: target.plan.settings,
          },
        )
        return [target.id, null]
      } catch (error) {
        return [target.id, error instanceof Error ? error.message : String(error)]
      }
    }),
  )
  return Object.fromEntries(outcomes)
}
