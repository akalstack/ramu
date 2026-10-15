import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import * as git from './git'
import { resolveEntryInRoot } from './files'
/** Covers HEAD/index and the exact worktree bytes the user is about to discard. */
export async function discardPreview(cwd: string, paths: string[]) {
  const status = await git.status(cwd)
  const hash = createHash('sha256').update(JSON.stringify(status)).update((await git.stagedPatch(cwd)).fingerprint)
  const files: { path: string; untracked: boolean }[] = []
  for (const path of [...new Set(paths)].sort()) {
    const entry = status.entries.find(entry => entry.path === path)
    if (!entry?.unstaged || entry.unstaged === 'unmerged') throw new Error('Changes changed or need conflict resolution. Refresh before discarding.')
    hash.update(path).update(entry.unstaged)
    const resolved = await resolveEntryInRoot(cwd, path)
    try {
      const metadata = await lstat(resolved)
      hash.update(String(metadata.mode))
      if (metadata.isSymbolicLink()) hash.update(await readlink(resolved))
      else if (metadata.isFile()) hash.update(await readFile(resolved))
      else throw new Error('Select individual files to discard')
    } catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') hash.update('missing'); else throw error }
    files.push({ path, untracked: entry.unstaged === 'untracked' })
  }
  return { fingerprint: hash.digest('hex'), files }
}
