import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { git, headOid, topLevel } from './git'

// A sub-agent that writes files can work in its own copy of the checkout, so parallel helpers never overwrite each other
// or the chat. The copy is a detached git worktree of the same repositories, based on the files as they are now
// (committed and uncommitted changes to tracked files). When the sub-agent finishes, its changes are applied back to the
// checkout, where the chat's own change review picks them up.

export interface IsolatedRepo { source: string; worktree: string; base: string }
export interface Isolation {
  root: string
  cwd: string
  additionalDirs: string[]
  /** The directories the sub-agent may write in: its worktrees. */
  covers: string[]
  repos: IsolatedRepo[]
}

/** The commit holding the checkout's tracked files as they are right now, without touching it. */
async function snapshotCommit(repo: string): Promise<string> {
  const stash = (await git(repo, ['stash', 'create']).catch(() => '')).trim()
  return stash || (await headOid(repo)) || ''
}

/**
 * Worktrees for the repositories a chat covers, laid out like the original so relative paths still make sense.
 * Returns null when nothing covered is a git repository: there is nothing to isolate.
 */
export async function createIsolation(options: { cwd: string; covers: string[]; root: string }): Promise<Isolation | null> {
  const repos: { source: string; dir: string }[] = []
  for (const cover of options.covers) {
    const source = await topLevel(cover).then(resolve, () => null)
    // A cover that is a folder inside a repository is not isolated on its own.
    if (source && source === resolve(cover) && !repos.some((entry) => entry.source === source)) repos.push({ source, dir: cover })
  }
  if (!repos.length) return null
  mkdirSync(options.root, { recursive: true })
  const made: IsolatedRepo[] = []
  const extra: string[] = []
  try {
    for (const [index, repo] of repos.entries()) {
      const inside = relative(resolve(options.cwd), repo.source)
      const inCwd = inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))
      const worktree = inCwd ? (inside === '' ? options.root : join(options.root, inside)) : join(options.root, '__extra', `${index}-${basename(repo.source)}`)
      const base = await snapshotCommit(repo.source)
      if (!base) throw new Error(`${basename(repo.source)} has no commits yet, so it cannot be copied for a sub-agent.`)
      mkdirSync(dirname(worktree), { recursive: true })
      await git(repo.source, ['worktree', 'add', '--detach', '--', worktree, base])
      made.push({ source: repo.source, worktree, base })
      if (!inCwd) extra.push(worktree)
    }
  } catch (error) {
    await removeIsolation({ root: options.root, cwd: options.root, additionalDirs: [], covers: [], repos: made })
    throw error
  }
  return { root: options.root, cwd: options.root, additionalDirs: extra, covers: made.map((entry) => entry.worktree), repos: made }
}

/** What the sub-agent changed in one worktree, as a binary-safe patch against its base; empty when nothing changed. */
export async function collectPatch(repo: IsolatedRepo): Promise<{ patch: string; files: string[] }> {
  await git(repo.worktree, ['add', '-A'])
  const files = (await git(repo.worktree, ['diff', '--cached', '--name-only', repo.base])).split('\n').filter(Boolean)
  if (!files.length) return { patch: '', files }
  return { patch: await git(repo.worktree, ['diff', '--cached', '--binary', repo.base]), files }
}

export interface ApplyOutcome { applied: number; failed: { repo: string; reason: string }[]; kept: string[] }

/**
 * Brings the sub-agent's changes back into the real checkouts. A repository whose patch does not apply cleanly is left
 * untouched, and its worktree is kept so nothing is lost.
 */
export async function applyIsolation(isolation: Isolation): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { applied: 0, failed: [], kept: [] }
  for (const repo of isolation.repos) {
    const { patch, files } = await collectPatch(repo)
    if (!files.length) { await removeWorktree(repo); continue }
    try {
      await git(repo.source, ['apply', '--check', '--binary', '--whitespace=nowarn'], { input: patch })
      await git(repo.source, ['apply', '--binary', '--whitespace=nowarn'], { input: patch })
      outcome.applied += files.length
      await removeWorktree(repo)
    } catch (error) {
      outcome.failed.push({ repo: basename(repo.source), reason: String(error instanceof Error ? error.message : error).split('\n')[0]!.slice(0, 200) })
      outcome.kept.push(repo.worktree)
    }
  }
  if (!outcome.kept.length) rmSync(isolation.root, { recursive: true, force: true })
  return outcome
}

async function removeWorktree(repo: IsolatedRepo): Promise<void> {
  await git(repo.source, ['worktree', 'remove', '--force', '--', repo.worktree]).catch(() => {})
  if (existsSync(repo.worktree)) rmSync(repo.worktree, { recursive: true, force: true })
  await git(repo.source, ['worktree', 'prune']).catch(() => {})
}

/** Throws the copy away, for instance after a failed start. */
export async function removeIsolation(isolation: Isolation): Promise<void> {
  for (const repo of isolation.repos) await removeWorktree(repo)
  if (existsSync(isolation.root)) rmSync(isolation.root, { recursive: true, force: true })
}
