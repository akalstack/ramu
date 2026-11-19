// Resolving merge and rebase conflicts by choosing a side: one conflict, a whole file, or every conflicted file.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { ConflictFile } from '@ramu/shared/types'
import { parseConflicts, resolveConflicts, type ConflictChoice } from '@ramu/shared/conflicts'
import { hashOf, resolveInRoot } from './files'
import { git, stage, status } from './git'

/** Larger files are left to the editor or an agent; the view would not help with them. */
const MAX_BYTES = 2 * 1024 * 1024

/** Which sides Git still has for a conflicted path: stage 2 is the current side, stage 3 the incoming one. */
async function sides(cwd: string, path: string): Promise<{ current: boolean; incoming: boolean }> {
  const out = await git(cwd, ['--literal-pathspecs', 'ls-files', '-u', '-z', '--', path])
  const stages = new Set(
    out
      .split('\0')
      .filter(Boolean)
      .map((line) => line.split('\t')[0]!.split(' ')[2]),
  )
  return { current: stages.has('2'), incoming: stages.has('3') }
}

async function conflictedPaths(cwd: string): Promise<string[]> {
  return (await status(cwd)).entries.filter((entry) => entry.staged === 'unmerged').map((entry) => entry.path)
}

/** A conflicted file as text with its hunks, or why it cannot be shown that way (binary, too large, deleted). */
export async function conflictFile(cwd: string, path: string): Promise<ConflictFile> {
  if (!(await conflictedPaths(cwd)).includes(path)) throw new Error(`${path} has no conflict to resolve.`)
  const { current, incoming } = await sides(cwd, path)
  const abs = await resolveInRoot(cwd, path)
  const base = { path, current, incoming }
  if (!existsSync(abs)) return { ...base, text: null, hash: null, hunks: [], reason: 'deleted' }
  const bytes = await readFile(abs)
  if (bytes.length > MAX_BYTES) return { ...base, text: null, hash: null, hunks: [], reason: 'too-large' }
  if (bytes.includes(0)) return { ...base, text: null, hash: null, hunks: [], reason: 'binary' }
  const text = bytes.toString('utf8')
  return { ...base, text, hash: hashOf(bytes), hunks: parseConflicts(text), reason: null }
}

/**
 * Keeps one side of a conflicted file. With `hunk`, only that conflict; otherwise all of them. When a file has no
 * markers to resolve (binary, deleted on one side), the whole file is taken from that side. A file with nothing left to
 * resolve is staged, which is how Git records it as resolved.
 */
export async function resolveConflict(
  cwd: string,
  path: string,
  choice: ConflictChoice,
  options: { hunk?: number; hash?: string } = {},
): Promise<{ resolved: boolean }> {
  const file = await conflictFile(cwd, path)
  if (options.hash && file.hash && options.hash !== file.hash)
    throw new Error(`${path} changed since it was opened. Look at it again before choosing.`)
  if (file.text !== null && file.hunks.length) {
    if (options.hunk !== undefined && !file.hunks.some((hunk) => hunk.index === options.hunk))
      throw new Error('That conflict is no longer in the file. Look at it again.')
    const next = resolveConflicts(file.text, options.hunk === undefined ? choice : new Map([[options.hunk, choice]]))
    await writeFile(await resolveInRoot(cwd, path), next, 'utf8')
    const left = parseConflicts(next).length
    if (!left) await stage(cwd, [path])
    return { resolved: !left }
  }
  if (options.hunk !== undefined)
    throw new Error('This file has no conflict markers. Choose a side for the whole file.')
  if (choice === 'both') throw new Error(`${path} cannot keep both sides here. Choose one side or edit it.`)
  const keep = choice === 'current' ? file.current : file.incoming
  if (!keep) await git(cwd, ['--literal-pathspecs', 'rm', '--quiet', '--', path])
  else {
    await git(cwd, ['--literal-pathspecs', 'checkout', choice === 'current' ? '--ours' : '--theirs', '--', path])
    await stage(cwd, [path])
  }
  return { resolved: true }
}

/** One side for every conflicted file; files that cannot take it (both, with no markers) are reported, not guessed. */
export async function resolveAllConflicts(
  cwd: string,
  choice: ConflictChoice,
): Promise<{ resolved: number; skipped: { path: string; error: string }[] }> {
  const skipped: { path: string; error: string }[] = []
  let resolved = 0
  for (const path of await conflictedPaths(cwd)) {
    try {
      if ((await resolveConflict(cwd, path, choice)).resolved) resolved++
    } catch (error) {
      skipped.push({ path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { resolved, skipped }
}
