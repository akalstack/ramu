/**
 * One name for a repository wherever it is cloned: its remote without the scheme, the user, the port or `.git`, in
 * lower case, so `git@github.com:Owner/Repo.git` and `https://github.com/owner/repo` are the same repository. Null for
 * a remote that names no host (a path on the same disk), which says nothing about another machine's checkout.
 */
export function repositoryIdentity(remote: string): string | null {
  const url = remote.trim()
  if (!url) return null
  // scp-like `user@host:path`, which has no scheme and no `//`.
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url)
  const parsed = scp ? { host: scp[1]!, path: scp[2]! } : hostAndPath(url)
  if (!parsed) return null
  const path = parsed.path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/\/+/g, '/')
  if (!path || !parsed.host.includes('.')) return null
  return `${parsed.host}/${path}`.toLowerCase()
}

function hostAndPath(url: string): { host: string; path: string } | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?(\/.*)$/i.exec(url)
  return match ? { host: match[1]!, path: match[2]! } : null
}

/**
 * Where a project belongs in a list across hosts: with every other project of the same repository, or, when its
 * repository is not known (no remote, or a host too old to say), on its own under its host.
 */
export function projectGroupKey(host: string, project: { id: string; repository?: string | null }): string {
  return project.repository ? `repository:${project.repository}` : `host:${host}:${project.id}`
}
