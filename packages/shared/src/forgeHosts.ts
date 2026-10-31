// Which hosting service a remote belongs to, from its address alone. Pure: no network, no file access.
import { normalizeOrigin } from './forgeRemote'

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

/**
 * The token a signed-in `glab` holds for one origin, read from its config file. Only `hosts.<origin>.token` is read;
 * anything else in the file is ignored. Returns null when the host has no token.
 */
export function glabToken(config: string, origin: string): string | null {
  return glabHosts(config).get(origin.toLowerCase()) ?? null
}

/** Every host `glab` is signed in to, with its token. */
export function glabHosts(config: string): Map<string, string> {
  const hosts = new Map<string, string>()
  let inHosts = false
  let hostIndent = -1
  let current: string | null = null
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
      current = key[1]!.toLowerCase()
      continue
    }
    if (current && key[1] === 'token') {
      const value = key[2]!.replace(/^["']|["']$/g, '').trim()
      if (value) hosts.set(current, value)
    }
  }
  return hosts
}
