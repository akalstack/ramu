// Live pull request events through Ramu Link: the Ramu GitHub App sends its events to the relay, and the relay passes on
// to each connected host only that a repository it may read changed, never what changed. Hosts and the relay agree on
// these shapes, so change them together and only in ways shipped hosts still read.

/** The Ramu GitHub App, installed on a repository or an organization to give its pull requests live updates. */
const RAMU_GITHUB_APP_URL = 'https://github.com/apps/ramu-by-akalstack'
export const RAMU_GITHUB_APP_INSTALL_URL = `${RAMU_GITHUB_APP_URL}/installations/new`

/** The relay path a host connects its event socket to, and the path the GitHub App delivers to. */
export const EVENTS_SOCKET_PATH = '/v1/events'
export const GITHUB_APP_EVENTS_PATH = '/github/events'

export const EVENT_LIMITS = {
  /** Repositories one connection watches. */
  reposPerConnection: 300,
  /** GitHub tokens one watch message carries (one per GitHub account the host uses). */
  tokensPerWatch: 10,
  /** A host pings this often; the relay answers without waking. */
  pingMs: 30_000,
  /** No pong for this long and the host reconnects. */
  silentMs: 45_000,
} as const

/** The keep-alive text a host sends and the relay answers, outside the JSON messages. */
export const EVENTS_PING = 'ping'
export const EVENTS_PONG = 'pong'

/** `owner/repo` on github.com, lower-cased, as both sides name a repository. */
export const REPO_KEY = /^[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/

export type HostMessage =
  /** The Ramu account session; nothing else is accepted before it. */
  | { t: 'hello'; bearer: string }
  /**
   * The repositories to hear about, each with a GitHub token that can read it. The relay checks each token against its
   * repositories once and keeps neither the tokens nor their answers beyond the connection.
   */
  | { t: 'watch'; groups: { token: string; repos: string[] }[] }

export type RepoEventState = 'live' | 'not-installed' | 'no-access'

export type RelayMessage =
  | { t: 'ready' }
  | { t: 'watching'; repos: { repo: string; state: RepoEventState }[] }
  /** The App was added to or removed from these watched repositories. */
  | { t: 'installed'; repos: string[]; installed: boolean }
  /** Something changed in a watched repository: read its pull requests again. */
  | { t: 'event'; repo: string; kind: string; number?: number; sha?: string }
  | { t: 'error'; reason: 'signed-out' | 'invalid' | 'too-many' }
