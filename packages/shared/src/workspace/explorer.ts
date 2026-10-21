import type { DirEntry, WorktreeWorkspace } from '../types'
export const explorerKey = (host: string, context: string, repo: string, path: string) =>
  JSON.stringify([host, context, repo, path])
export const sortEntries = (entries: DirEntry[]) =>
  [...entries].sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'dir' ? -1 : 1))
export function projectExplorerContext(host: string, projectId: string): string {
  const prefix = `${host}:`
  if (!projectId.startsWith(prefix) || projectId.length === prefix.length)
    throw new Error('Project belongs to another host')
  return `project:${projectId.slice(prefix.length)}`
}

/** Workspace IDs are server-local. Only join a catalog to projects from its owning host. */
export function projectWorkspaces(
  host: string,
  projectId: string,
  workspaces: WorktreeWorkspace[],
): WorktreeWorkspace[] {
  const context = projectExplorerContext(host, projectId)
  const rawProject = context.slice('project:'.length)
  return workspaces.filter((workspace) => workspace.projectId === rawProject)
}
export function flattenExplorer(
  repoId: string,
  directories: Record<string, DirEntry[]>,
  expanded: Set<string>,
  parent = '',
  depth = 0,
): { repoId: string; entry: DirEntry; depth: number }[] {
  if (depth > 80) return []
  return sortEntries(directories[parent] ?? []).flatMap((entry) => [
    { repoId, entry, depth },
    ...(entry.kind === 'dir' && expanded.has(`${repoId}:${entry.path}`)
      ? flattenExplorer(repoId, directories, expanded, entry.path, depth + 1)
      : []),
  ])
}

/** The root and strict ancestors needed to reveal a relative file path. Invalid deep links cannot widen scope. */
export function explorerAncestors(path: string): string[] {
  if (
    !path ||
    path.length > 4096 ||
    path.includes('\\') ||
    path.includes(String.fromCharCode(0)) ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  )
    return []
  const parts = path.split('/')
  if (parts.length > 81 || parts.some((part) => !part || part === '.' || part === '..')) return []
  return ['', ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]
}

export const EXPLORER_SEARCH_LIMIT = 200

/** Case-insensitive path match over the bounded quick-open index. Same-named files in different repositories stay distinct; the result never exceeds the limit. */
export function searchExplorerFiles<T extends { repoId: string; path: string }>(
  files: T[],
  query: string,
  limit = EXPLORER_SEARCH_LIMIT,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: T[] = []
  for (const file of files) {
    if (!file.path.toLowerCase().includes(needle)) continue
    matches.push(file)
    if (matches.length >= limit) break
  }
  return matches
}
