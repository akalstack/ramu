import { sha256Hex } from './sha256'

/**
 * What a link in a pull request's text points at on its hosting service, so the app can open it in place: a pull
 * request (or its changed files), an issue, or a file or folder in a repository. `repo` is the repository's path on the
 * service (`owner/name`, or `group/sub/name` on GitLab), compared case-insensitively.
 */
export type ForgeLink =
  | { kind: 'pull'; repo: string; number: number; files: boolean; anchor?: string }
  | { kind: 'issue'; repo: string; number: number }
  | { kind: 'file'; repo: string; ref: string; path: string; line?: number }
  | { kind: 'folder'; repo: string; ref: string; path: string }

const SERVICE_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/i

const lineOf = (hash: string) => {
  const found = /^#?(?:L|lines-)(\d+)/i.exec(hash)
  return found ? Number(found[1]) : undefined
}

/**
 * Reads a link written in a pull request's description or comments. `base` is the pull request's own address, which
 * resolves a relative link (`docs/setup.md`, `../src/a.ts`) to a file in its repository at `ref` (its head branch), as
 * the service does. Anything else (another site, a mailto, an in-page anchor) is null, and opens in the browser.
 */
export function parseForgeLink(href: string, base: { url: string; ref: string }): ForgeLink | null {
  const own = forgeRepoOf(base.url)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')) {
    if (!own || !href || href.startsWith('#')) return null
    const [pathPart, hash = ''] = href.split('#')
    const segments: string[] = []
    for (const piece of pathPart!.replace(/^\.?\//, '').split('/')) {
      if (piece === '..') segments.pop()
      else if (piece && piece !== '.') segments.push(decodeURIComponent(piece))
    }
    if (!segments.length) return null
    const line = lineOf(`#${hash}`)
    return { kind: 'file', repo: own.repo, ref: base.ref, path: segments.join('/'), ...(line ? { line } : {}) }
  }
  let url: URL
  try {
    url = new URL(href, base.url)
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol) || (!SERVICE_HOSTS.test(url.hostname) && url.hostname !== own?.host)) return null
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  // GitLab puts its routes after `/-/`, below any number of groups.
  const dash = parts.indexOf('-')
  const [repoParts, rest] =
    dash > 1 ? [parts.slice(0, dash), parts.slice(dash + 1)] : [parts.slice(0, 2), parts.slice(2)]
  if (repoParts.length < 2) return null
  const repo = repoParts.join('/')
  const [route, id, ...tail] = rest
  const number = Number(id)
  if ((route === 'pull' || route === 'merge_requests' || route === 'pull-requests') && Number.isInteger(number))
    return {
      kind: 'pull',
      repo,
      number,
      files: tail[0] === 'files' || tail[0] === 'diffs',
      ...(url.hash.startsWith('#diff-') ? { anchor: url.hash.slice(1) } : {}),
    }
  if (route === 'issues' && Number.isInteger(number)) return { kind: 'issue', repo, number }
  if ((route === 'blob' || route === 'src' || route === 'tree') && id && tail.length) {
    const path = tail.join('/')
    if (route === 'tree') return { kind: 'folder', repo, ref: id, path }
    const line = lineOf(url.hash)
    return { kind: 'file', repo, ref: id, path, ...(line ? { line } : {}) }
  }
  return null
}

/** The repository path and host of a pull request's address. */
export function forgeRepoOf(url: string): { host: string; repo: string } | null {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const dash = parts.indexOf('-')
    const repo = (dash > 1 ? parts.slice(0, dash) : parts.slice(0, 2)).join('/')
    return repo.includes('/') ? { host: parsed.hostname, repo } : null
  } catch {
    return null
  }
}

/** Whether two repository paths name the same repository. */
export const sameForgeRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The changed file a GitHub `#diff-…` anchor names: GitHub writes the SHA-256 of the file's path, then `R12`/`L12` for a
 * line on the new or old side.
 */
export function diffAnchorFile(
  anchor: string,
  paths: readonly string[],
): { path: string; line?: number; side?: 'new' | 'old' } | null {
  const found = /^diff-([0-9a-f]{64})(?:([RL])(\d+))?/i.exec(anchor)
  if (!found) return null
  const hash = found[1]!.toLowerCase()
  const path = paths.find((candidate) => sha256Hex(new TextEncoder().encode(candidate)) === hash)
  if (!path) return null
  return found[2] ? { path, line: Number(found[3]), side: found[2].toUpperCase() === 'R' ? 'new' : 'old' } : { path }
}
