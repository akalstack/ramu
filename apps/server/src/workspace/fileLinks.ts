import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { HOST_FILES_REPO, localFileLink } from '@ramu/shared/workspace/fileLinks'
import { listFolderFiles, resolveInRoot } from './files'
import { listFiles } from './git'
import type { Workspace } from './workspace'

export async function resolveFileLink(
  workspace: Workspace,
  taskId: string,
  href: string,
  options: { folders?: boolean } = {},
  withheld: string[] = [],
) {
  const target = localFileLink(href)
  if (!target) return null
  const bindings = workspace.fileBindings(taskId),
    scope = workspace.agentScope(taskId)
  const candidates = isAbsolute(target.path)
    ? [target.path]
    : [...new Set([scope.cwd, ...bindings.map((binding) => binding.cwd)])].map((cwd) => resolve(cwd, target.path))
  const matches = new Map<
    string,
    { repoId: string; path: string; line?: number; column?: number; kind?: 'file' | 'folder' }
  >()
  for (const candidate of candidates)
    for (const binding of bindings) {
      if (binding.setupState !== 'ready') continue
      const path = relative(binding.cwd, candidate)
      try {
        const absolute = await resolveInRoot(binding.cwd, path)
        const info = await stat(absolute)
        if (info.isDirectory() && options.folders)
          matches.set(absolute, { repoId: binding.repoId, path: path.replace(/\\/g, '/'), kind: 'folder' })
        if (!info.isFile()) continue
        matches.set(absolute, {
          repoId: binding.repoId,
          path: path.replace(/\\/g, '/'),
          line: target.line,
          column: target.column,
        })
      } catch {
        /* Missing files and references outside this chat's folders are not editor targets. */
      }
    }
  if (matches.size) return matches.size === 1 ? [...matches.values()][0]! : null
  // A file beside the repositories, such as a draft in the project folder, or one the agent wrote elsewhere on the host.
  const outside = await hostFile(isAbsolute(target.path) ? target.path : resolve(scope.cwd, target.path), target, [
    ...workspace.managedFolders(),
    ...withheld,
  ])
  if (outside) return outside
  return isAbsolute(target.path) || /^\.{1,2}[\\/]/.test(target.path)
    ? null
    : endingWith(bindings, target, options.folders === true)
}

async function hostFile(absolute: string, target: { line?: number; column?: number }, withheld: string[]) {
  // The host-files root is `/`; a Windows path on another drive has no relative form under it.
  if (sep !== '/' || withheldPath(absolute, withheld)) return null
  try {
    if (!(await stat(absolute)).isFile()) return null
  } catch {
    return null
  }
  return { repoId: HOST_FILES_REPO, path: relative('/', absolute), line: target.line, column: target.column }
}

/**
 * Whether a file outside the thread's folders lies, after symlinks, in a folder Ramu keeps to itself: other threads'
 * worktrees and chat folders, or the host's own data with its credentials. A file that does not exist yet is judged by
 * its folder.
 */
export function withheldPath(absolute: string, roots: string[]): boolean {
  const real = (path: string): string | null => {
    try {
      return realpathSync(path)
    } catch {
      const parent = dirname(path)
      if (parent === path) return null
      const folder = real(parent)
      return folder && join(folder, basename(path))
    }
  }
  const target = real(absolute)
  if (!target) return true
  return roots.some((root) => {
    const base = real(root)
    if (!base) return false
    const rel = relative(base, target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/**
 * Agents often write a path from somewhere inside the project rather than its root (`mobile/README.md` for
 * `apps/mobile/README.md`, `releases/x.md` under `docs/`). When the path is not found as written, the one file (or
 * folder) in this thread's checkouts whose path ends with it is the one meant; more than one is left unresolved.
 */
async function endingWith(
  bindings: ReturnType<Workspace['fileBindings']>,
  target: { path: string; line?: number; column?: number },
  folders: boolean,
) {
  const wanted = target.path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!wanted.includes('/') && !folders) return null
  const found = new Map<string, { repoId: string; path: string; line?: number; column?: number; kind?: 'folder' }>()
  for (const binding of bindings) {
    if (binding.setupState !== 'ready') continue
    let paths: string[]
    try {
      paths = await (binding.folderOnly ? listFolderFiles(binding.cwd) : listFiles(binding.cwd))
    } catch {
      continue
    }
    for (const path of paths) {
      if (path === wanted || path.endsWith(`/${wanted}`))
        found.set(`${binding.repoId}:${path}`, {
          repoId: binding.repoId,
          path,
          line: target.line,
          column: target.column,
        })
      else if (folders) {
        const at = `/${path}`.indexOf(`/${wanted}/`)
        if (at >= 0) {
          const folder = path.slice(0, at + wanted.length)
          found.set(`${binding.repoId}:${folder}/`, { repoId: binding.repoId, path: folder, kind: 'folder' })
        }
      }
      if (found.size > 1) return null
    }
  }
  return found.size === 1 ? [...found.values()][0]! : null
}
