import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { abilityChoices, appPreferences } from '../ipc/preferences'
import { STACK_IDS } from '@ramu/shared/stacks'
import { FINISH_LINES, MAX_SHIP_ROUNDS } from '@ramu/shared/ship'
import { commitBranchInfo, git } from './git'

export const projectActionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(4000),
  keys: z.string().max(40).optional(),
})

const shipRounds = z.number().int().min(0).max(MAX_SHIP_ROUNDS)

/** How far Ship may carry a change in this repository: it can only stop the loop earlier than the host would. */
export const shipConfigSchema = z.object({
  finishLine: z.enum(FINISH_LINES).optional(),
  maxCiFixes: shipRounds.optional(),
  maxReviewRounds: shipRounds.optional(),
})
export type ShipConfig = z.infer<typeof shipConfigSchema>

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
  /** Ability choices for this project over the host's Settings → Models → Abilities, such as one provider for a client. */
  abilities: abilityChoices.optional(),
  /** What a new project was started with, so later threads know how to run, build, test and deploy it. */
  stack: z
    .object({
      id: z.enum(STACK_IDS).optional(),
      /** A framework an agent looked up rather than one of Ramu's stacks, such as Tauri. */
      name: z.string().trim().min(1).max(60).optional(),
      dev: z.string().trim().min(1).max(1000).optional(),
      build: z.string().trim().min(1).max(1000).optional(),
      test: z.string().trim().min(1).max(1000).optional(),
      /** Stores data in a Postgres database. */
      database: z.boolean().optional(),
      /** An argument list, run before each production deploy from Ramu. */
      migrate: z.array(z.string().min(1).max(1000)).min(1).max(50).optional(),
      /** The path the uptime watch checks on the live address, such as `/api/health`. */
      healthPath: z
        .string()
        .max(200)
        .regex(/^\/(?!\/)[^\s\\#]*$/, 'A path on the live address, starting with one /')
        .optional(),
    })
    .optional(),
  ship: shipConfigSchema.optional(),
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

/** Shipping starts without the fresh copy when the Git host is this slow; the last fetched one applies then. */
const FETCH_WAIT_MS = 15_000
const UNREADABLE_SHIP: ShipConfig = { finishLine: 'pull-request' }

/**
 * The `ship` limits as committed on the default branch, never the checkout's copy: an agent works in the checkout and
 * could otherwise raise its own finish line. Null when there is no default branch or no file there.
 */
export async function committedShipConfig(root: string, options: { fetch?: boolean } = {}): Promise<ShipConfig | null> {
  const { defaultBranch } = await commitBranchInfo(root).catch(() => ({ defaultBranch: null }))
  if (!defaultBranch) return null
  // The Git host's copy when there is one; a local default branch can carry commits nobody reviewed. Fetched first when
  // an agent starts shipping, so a remote-tracking ref rewritten in the checkout is replaced by what the host has.
  const remote = `refs/remotes/origin/${defaultBranch}`
  if (options.fetch)
    await Promise.race([
      git(root, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${defaultBranch}:${remote}`]).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, FETCH_WAIT_MS).unref?.()),
    ])
  const ref = (await git(root, ['rev-parse', '--verify', '--quiet', remote]).catch(() => '')).trim()
    ? remote
    : `refs/heads/${defaultBranch}`
  for (const source of ['ramu.json', '.ramu/config.json']) {
    const text = await git(root, ['show', `${ref}:${source}`]).catch(() => null)
    if (text === null) continue
    // A limit the team wrote but Ramu cannot read stops at the earliest line rather than at none.
    if (text.length > 256 * 1024) return UNREADABLE_SHIP
    try {
      const parsed = shipConfigSchema.safeParse((JSON.parse(text) as { ship?: unknown }).ship ?? {})
      return parsed.success ? parsed.data : UNREADABLE_SHIP
    } catch {
      return UNREADABLE_SHIP
    }
  }
  return null
}
