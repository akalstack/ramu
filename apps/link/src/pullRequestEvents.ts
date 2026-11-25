// The relay's side of live pull request events. The Ramu GitHub App delivers here; each host holds one socket and says
// which repositories it wants, proving with its own GitHub token that it can read each one. An event goes on only as
// "this repository changed" (with the pull request number and commit when GitHub names them), never its text, and only
// to the sockets that proved access. Nothing about a host or its tokens outlives its connection.
import {
  EVENT_LIMITS,
  REPO_KEY,
  type HostMessage,
  type RelayMessage,
  type RepoEventState,
} from '@ramu/shared/pullRequestEvents'

/** What a socket carries across the Durable Object sleeping: who it is and what it may hear. */
export interface Attachment {
  user: string | null
  /** Repositories this socket proved it can read. */
  repos: string[]
}

export interface EventSocket {
  send(message: string): void
  close(code: number, reason: string): void
  attachment(): Attachment | null
  attach(value: Attachment): void
}

/** Repositories the App is installed on, by installation, kept by the Durable Object. */
export interface InstalledStore {
  has(repo: string): boolean
  add(installation: number, repos: string[]): void
  remove(repos: string[]): void
  /** Removes every repository of an installation and returns them. */
  dropInstallation(installation: number): string[]
}

export interface EventsDeps {
  sockets(): EventSocket[]
  installed: InstalledStore
  /** The Ramu account a session belongs to, or null when it is not signed in. */
  account(bearer: string): Promise<string | null>
  /** Whether a GitHub token can read a repository. */
  canRead(repo: string, token: string): Promise<boolean>
  /** The GitHub App's webhook secret. */
  secret: string
}

const send = (socket: EventSocket, message: RelayMessage) => socket.send(JSON.stringify(message))

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** GitHub's `X-Hub-Signature-256` for a body, compared in constant time. */
export async function signedByGithub(secret: string, body: ArrayBuffer, signature: string | null): Promise<boolean> {
  if (!secret || !signature?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = `sha256=${hex(await crypto.subtle.sign('HMAC', key, body))}`
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let index = 0; index < expected.length; index++) diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  return diff === 0
}

type Payload = {
  action?: string
  installation?: { id?: number }
  repository?: { full_name?: string }
  repositories?: { full_name?: string }[]
  repositories_added?: { full_name?: string }[]
  repositories_removed?: { full_name?: string }[]
  number?: number
  pull_request?: { number?: number; head?: { sha?: string } }
  check_run?: { head_sha?: string; pull_requests?: { number?: number }[] }
  check_suite?: { head_sha?: string; pull_requests?: { number?: number }[] }
  issue?: { number?: number; pull_request?: unknown }
  sha?: string
  after?: string
}

const names = (list: { full_name?: string }[] | undefined) =>
  (list ?? []).flatMap((entry) => {
    const name = entry.full_name?.toLowerCase()
    return name && REPO_KEY.test(name) ? [name] : []
  })

/** The pull request and commit an event is about, when GitHub names them. Nothing else of the payload leaves here. */
export function eventTarget(payload: Payload): { number?: number; sha?: string } {
  const number =
    payload.pull_request?.number ??
    (payload.issue?.pull_request ? payload.issue.number : undefined) ??
    payload.check_run?.pull_requests?.[0]?.number ??
    payload.check_suite?.pull_requests?.[0]?.number ??
    (typeof payload.number === 'number' ? payload.number : undefined)
  const sha =
    payload.pull_request?.head?.sha ??
    payload.check_run?.head_sha ??
    payload.check_suite?.head_sha ??
    payload.sha ??
    payload.after
  return {
    ...(typeof number === 'number' && Number.isSafeInteger(number) ? { number } : {}),
    ...(typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? { sha } : {}),
  }
}

/** Events that change nothing a pull request view shows are dropped here instead of waking every host. */
const IGNORED = new Set(['ping', 'star', 'watch', 'fork', 'member', 'meta', 'repository', 'label', 'milestone'])

export function createPullRequestEvents(deps: EventsDeps) {
  const watching = (socket: EventSocket, repo: string) => socket.attachment()?.repos.includes(repo) === true

  /** Tells each socket watching these repositories that the App was added to or removed from them. */
  const announceInstalled = (repos: string[], installed: boolean) => {
    if (!repos.length) return
    for (const socket of deps.sockets()) {
      const mine = repos.filter((repo) => watching(socket, repo))
      if (mine.length) send(socket, { t: 'installed', repos: mine, installed })
    }
  }

  async function message(socket: EventSocket, text: string): Promise<void> {
    let parsed: HostMessage
    try {
      parsed = JSON.parse(text) as HostMessage
    } catch {
      return send(socket, { t: 'error', reason: 'invalid' })
    }
    if (!parsed || typeof parsed !== 'object') return send(socket, { t: 'error', reason: 'invalid' })
    const current = socket.attachment() ?? { user: null, repos: [] }
    if (parsed.t === 'hello') {
      const user = typeof parsed.bearer === 'string' && parsed.bearer ? await deps.account(parsed.bearer) : null
      if (!user) {
        send(socket, { t: 'error', reason: 'signed-out' })
        return socket.close(4001, 'signed out')
      }
      socket.attach({ user, repos: [] })
      return send(socket, { t: 'ready' })
    }
    if (!current.user) return send(socket, { t: 'error', reason: 'signed-out' })
    if (parsed.t !== 'watch' || !Array.isArray(parsed.groups) || parsed.groups.length > EVENT_LIMITS.tokensPerWatch)
      return send(socket, { t: 'error', reason: 'invalid' })
    const asked = parsed.groups.flatMap((group) =>
      typeof group?.token === 'string' && Array.isArray(group.repos)
        ? group.repos.flatMap((repo) =>
            typeof repo === 'string' && REPO_KEY.test(repo.toLowerCase())
              ? [{ repo: repo.toLowerCase(), token: group.token }]
              : [],
          )
        : [],
    )
    if (asked.length > EVENT_LIMITS.reposPerConnection) return send(socket, { t: 'error', reason: 'too-many' })
    // Each repository is checked with the token its host named for it; one that cannot read it hears nothing of it.
    const answers = await Promise.all(
      asked.map(async ({ repo, token }) => ({
        repo,
        readable: await deps.canRead(repo, token).catch(() => false),
      })),
    )
    const readable = [...new Set(answers.filter((answer) => answer.readable).map((answer) => answer.repo))]
    socket.attach({ user: current.user, repos: readable })
    send(socket, {
      t: 'watching',
      repos: answers.map(({ repo, readable: ok }) => ({
        repo,
        state: (!ok ? 'no-access' : deps.installed.has(repo) ? 'live' : 'not-installed') satisfies RepoEventState,
      })),
    })
  }

  /** A delivery from the GitHub App. */
  async function github(request: { event: string | null; signature: string | null; body: ArrayBuffer }) {
    if (!(await signedByGithub(deps.secret, request.body, request.signature))) return 401
    const event = request.event ?? ''
    let payload: Payload
    try {
      payload = JSON.parse(new TextDecoder().decode(request.body)) as Payload
    } catch {
      return 400
    }
    const installation = payload.installation?.id
    if (event === 'installation' && typeof installation === 'number') {
      if (payload.action === 'deleted' || payload.action === 'suspend')
        announceInstalled(deps.installed.dropInstallation(installation), false)
      else {
        const repos = names(payload.repositories)
        deps.installed.add(installation, repos)
        announceInstalled(repos, true)
      }
      return 202
    }
    if (event === 'installation_repositories' && typeof installation === 'number') {
      const added = names(payload.repositories_added)
      const removed = names(payload.repositories_removed)
      deps.installed.add(installation, added)
      deps.installed.remove(removed)
      announceInstalled(added, true)
      announceInstalled(removed, false)
      return 202
    }
    const repo = payload.repository?.full_name?.toLowerCase()
    if (!repo || !REPO_KEY.test(repo)) return 202
    // A repository that sends events has the App, also one installed before the relay first heard of it.
    if (typeof installation === 'number' && !deps.installed.has(repo)) {
      deps.installed.add(installation, [repo])
      announceInstalled([repo], true)
    }
    if (IGNORED.has(event)) return 202
    const message: RelayMessage = { t: 'event', repo, kind: event.slice(0, 40), ...eventTarget(payload) }
    const text = JSON.stringify(message)
    for (const socket of deps.sockets()) if (watching(socket, repo)) socket.send(text)
    return 202
  }

  return { message, github }
}
