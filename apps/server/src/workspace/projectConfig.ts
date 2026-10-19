import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { appPreferences } from '../ipc/preferences'

export const projectActionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(4000),
  keys: z.string().max(40).optional(),
})

/** Repository configuration deliberately excludes credentials, binaries and permission escalation. */
export const projectConfigSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  agent: z
    .object({
      preferredProvider: z.string().trim().min(1).max(80).optional(),
      preferredModel: z.string().trim().min(1).max(200).optional(),
    })
    .optional(),
  actions: z
    .array(projectActionSchema)
    .max(30)
    .refine(
      (actions) => new Set(actions.map((action) => action.id)).size === actions.length,
      'Action IDs must be unique',
    )
    .optional(),
  workspace: z
    .object({
      defaultCheckoutMode: appPreferences.shape.defaultCheckoutMode.removeDefault().optional(),
      branchPrefix: appPreferences.shape.worktreeBranchPrefix.removeDefault().optional(),
      branchNaming: z
        .preprocess((value) => (value === 'summary-slug' ? 'fixed' : value), z.enum(['fixed', 'semantic', 'custom']))
        .optional(),
      branchInstructions: appPreferences.shape.worktreeBranchInstructions.removeDefault().optional(),
    })
    .optional(),
  commit: z
    .object({
      commitStyle: appPreferences.shape.commitStyle.removeDefault().optional(),
      commitInstructions: appPreferences.shape.commitInstructions.removeDefault().optional(),
    })
    .optional(),
})

export type ProjectConfig = z.infer<typeof projectConfigSchema>
export interface ProjectConfigResult {
  source?: 'ramu.json' | '.ramu/config.json'
  config: ProjectConfig
  error?: string
}

/** A read never runs commands, creates folders or allocates a workspace. Primary file wins, even if invalid. */
export function loadProjectConfig(root: string | null): ProjectConfigResult {
  if (!root) return { config: {} }
  for (const source of ['ramu.json', '.ramu/config.json'] as const) {
    let fd: number | undefined
    try {
      const base = realpathSync(root)
      const path = realpathSync(join(base, source))
      const rel = relative(base, path)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
        throw new Error('Outside project')
      fd = openSync(path, 'r')
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Invalid configuration file')
      return { source, config: projectConfigSchema.parse(JSON.parse(readFileSync(fd, 'utf8'))) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return { source, config: {}, error: 'Project configuration is invalid or unavailable.' }
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  return { config: {} }
}
