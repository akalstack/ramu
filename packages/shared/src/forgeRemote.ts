/** A Git remote reduced to what choosing a hosting account needs. Pure: no network, no file access. */
export interface ForgeRemote {
  /** Lowercase `host` or `host:port` the credentials are bound to. SSH ports are ignored: they are not the API's. */
  origin: string
  protocol: 'https' | 'http' | 'ssh' | 'git'
  owner: string
  repo: string
}

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

/** `host` or `host:port` of a user-entered server, lowercase, or null when it is not a plain origin. */
export function normalizeOrigin(input: string): string | null {
  const text = input.trim().toLowerCase()
  // No scheme, path, credentials or whitespace: an origin is only what a credential may be bound to.
  const match = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(text)
  if (!match || !HOST.test(match[1]!) || match[1]!.length > 253) return null
  const port = match[2] ? Number(match[2]) : null
  if (port !== null && (port < 1 || port > 65535)) return null
  return port === null ? match[1]! : `${match[1]}:${port}`
}

function ownerAndRepo(path: string): { owner: string; repo: string } | null {
  const parts = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .split('/')
  if (parts.length < 2 || parts.some((part) => !part)) return null
  // A GitHub Enterprise server on a sub-path would add segments in front; the last two always name the repository.
  return { owner: parts[parts.length - 2]!, repo: parts[parts.length - 1]! }
}

/**
 * HTTPS, SSH (`ssh://` and scp-style) and git remotes. Returns null for local paths, malformed values and URLs with an
 * embedded password, so a token pasted into a remote is never treated as a usable identity.
 */
export function parseForgeRemote(url: string): ForgeRemote | null {
  const text = url.trim()
  if (!text) return null
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)
  const scp = hasScheme ? null : /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):([^\s]+)$/.exec(text)
  if (scp && !/^[A-Za-z]:[\\/]/.test(text)) {
    const origin = normalizeOrigin(scp[1]!)
    const names = ownerAndRepo(scp[2]!)
    return origin && names ? { origin, protocol: 'ssh', ...names } : null
  }
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  const protocol = parsed.protocol.replace(':', '')
  if (!['https', 'http', 'ssh', 'git'].includes(protocol) || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  const port = protocol === 'https' || protocol === 'http' ? parsed.port : ''
  const origin = normalizeOrigin(port ? `${host}:${port}` : host)
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  const names = ownerAndRepo(path)
  return origin && names ? { origin, protocol: protocol as ForgeRemote['protocol'], ...names } : null
}

/** REST API base for a GitHub origin: github.com has its own host, Enterprise serves `/api/v3`. */
export function githubApiBase(origin: string): string {
  return origin === 'github.com' ? 'https://api.github.com' : `https://${origin}/api/v3`
}

/** Removes anything that looks like a token or a credential-bearing URL from provider text before it is shown or logged. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [redacted]')
}
