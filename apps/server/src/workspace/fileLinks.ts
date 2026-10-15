import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'
import { resolveInRoot } from './files'
import type { Workspace } from './workspace'

export async function resolveFileLink(workspace: Workspace, taskId: string, href: string) {
  const target = localFileLink(href)
  if (!target) return null
  const bindings = workspace.fileBindings(taskId),
    scope = workspace.agentScope(taskId)
  const candidates = isAbsolute(target.path)
    ? [target.path]
    : [...new Set([scope.cwd, ...bindings.map((binding) => binding.cwd)])].map((cwd) => resolve(cwd, target.path))
  const matches = new Map<string, { repoId: string; path: string; line?: number; column?: number }>()
  for (const candidate of candidates)
    for (const binding of bindings) {
      if (binding.setupState !== 'ready') continue
      const path = relative(binding.cwd, candidate)
      try {
        const absolute = await resolveInRoot(binding.cwd, path)
        if (!(await stat(absolute)).isFile()) continue
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
  return matches.size === 1 ? [...matches.values()][0]! : null
}
