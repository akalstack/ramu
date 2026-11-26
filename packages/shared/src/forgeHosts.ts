// Which hosting service a remote belongs to, from its address alone. Pure: no network, no file access.
import { normalizeOrigin, parseForgeRemote } from './forgeRemote'

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket' | 'azure'

/**
 * The service behind an origin. GitHub stays the answer for any server not recognised otherwise, so an Enterprise
 * server keeps working as before; `gitlabHosts` names self-managed GitLab servers the host's own sign-ins know.
 */
export function forgeKind(origin: string, gitlabHosts: ReadonlySet<string> = new Set()): ForgeKind {
  const host = origin.toLowerCase().replace(/:\d+$/, '')
  if (host === 'gitlab.com' || gitlabHosts.has(origin.toLowerCase()) || gitlabHosts.has(host)) return 'gitlab'
  if (host === 'bitbucket.org') return 'bitbucket'
  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || host.endsWith('.visualstudio.com')) return 'azure'
  return 'github'
}

/** A GitLab project as its remote names it: the API origin and the full namespace path (groups may nest). */
export interface GitlabProject {
  origin: string
  /** `group/subgroup/project`, without `.git`. */
  path: string
}

/** HTTPS and SSH (`ssh://` and scp-style) GitLab remotes. Rejects embedded passwords, like `parseForgeRemote`. */
export function parseGitlabRemote(url: string): GitlabProject | null {
  const text = url.trim()
  const scp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)
    ? null
    : /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):([^\s]+)$/.exec(text)
  let origin: string | null
  let path: string
  if (scp) {
    origin = normalizeOrigin(scp[1]!)
    path = scp[2]!
  } else {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol) || parsed.password) return null
    const port = parsed.protocol === 'ssh:' ? '' : parsed.port
    origin = normalizeOrigin(port ? `${parsed.hostname}:${port}` : parsed.hostname)
    path = decodeURIComponent(parsed.pathname)
  }
  const clean = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    // GitLab's own SSH form puts the path after `scm/` on some installations; the project path never contains `-/`.
    .split('/-/')[0]!
  const parts = clean.split('/')
  if (!origin || parts.length < 2 || parts.some((part) => !part || part === '..')) return null
  return { origin, path: parts.join('/') }
}

/** One host `glab` is signed in to, as its config file describes it. */
export interface GlabHost {
  /** The token when the file holds it; `null` when glab keeps it in the OS keyring. */
  token: string | null
  /** Signed in through glab's OAuth web flow: the token is a short-lived bearer token glab refreshes. */
  oauth: boolean
  /** When an OAuth token expires, in milliseconds since the epoch. */
  expiresAt: number | null
}

/**
 * Every host `glab` is signed in to: one with a token in the file, or with its credentials in the OS keyring. Only the
 * sign-in fields under `hosts.<origin>` are read; anything else in the file is ignored.
 */
export function glabHosts(config: string): Map<string, GlabHost> {
  const fields = new Map<string, Map<string, string>>()
  let inHosts = false
  let hostIndent = -1
  let current: Map<string, string> | null = null
  for (const raw of config.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (indent === 0) {
      inHosts = line === 'hosts:'
      current = null
      hostIndent = -1
      continue
    }
    if (!inHosts) continue
    const key = /^"?([^":]+)"?:\s*(.*)$/.exec(line)
    if (!key) continue
    if (hostIndent === -1 || indent <= hostIndent) {
      hostIndent = indent
      current = new Map()
      fields.set(key[1]!.toLowerCase(), current)
      continue
    }
    current?.set(key[1]!, key[2]!.replace(/^["']|["']$/g, '').trim())
  }
  const hosts = new Map<string, GlabHost>()
  for (const [origin, host] of fields) {
    const token = host.get('token') || null
    if (!token && host.get('use_keyring') !== 'true') continue
    const expiry = Date.parse(host.get('oauth2_expiry_date') ?? '')
    hosts.set(origin, {
      token,
      oauth: host.get('is_oauth2') === 'true',
      expiresAt: Number.isFinite(expiry) ? expiry : null,
    })
  }
  return hosts
}

/**
 * Where a commit is shown on its hosting service, from the repository's remote. Null for a remote that is not on a
 * service, and for Azure DevOps, whose address names a project the remote alone does not give reliably.
 */
export function commitWebUrl(remoteUrl: string, kind: ForgeKind, oid: string): string | null {
  if (kind === 'gitlab') {
    const project = parseGitlabRemote(remoteUrl)
    return project ? `https://${project.origin}/${project.path}/-/commit/${oid}` : null
  }
  const remote = parseForgeRemote(remoteUrl)
  if (!remote || kind === 'azure') return null
  const base = `https://${remote.origin}/${remote.owner}/${remote.repo}`
  return kind === 'bitbucket' ? `${base}/commits/${oid}` : `${base}/commit/${oid}`
}
