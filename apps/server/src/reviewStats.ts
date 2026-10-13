import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ChangeFile } from '@ramu/shared/types'
const exec = promisify(execFile)

/** Git computes counts from the saved texts, never from the current checkout. */
export async function reviewLineStats(files: ChangeFile[], directory: string): Promise<ChangeFile[]> {
  const text = files.filter((f) => !f.binary)
  if (!text.length) return files
  const temp = await mkdtemp(join(directory, '.line-stats-'))
  try {
    const before = join(temp, 'before'), after = join(temp, 'after')
    await mkdir(before); await mkdir(after)
    for (const file of text) {
      if (file.status !== 'added') await writeFile(join(before, `${file.id}.txt`), file.oldContent)
      if (file.status !== 'deleted') await writeFile(join(after, `${file.id}.txt`), file.newContent)
    }
    let stdout: string
    try { stdout = (await exec('git', ['-c', 'color.ui=false', 'diff', '--no-index', '--numstat', '--no-renames', '--no-ext-diff', '--no-textconv', '--text', '--', before, after], { timeout: 30000, maxBuffer: 4_000_000 })).stdout }
    catch (error) {
      const diff = error as { code?: number; stdout?: string }
      if (diff.code !== 1 || typeof diff.stdout !== 'string') throw error
      stdout = diff.stdout
    }
    // Git abbreviates added and removed files as `{a => b}`, so the id is picked out of whatever path text it prints.
    const known = new Set(text.map((file) => file.id))
    const counts = new Map<string, { addedLines: number; removedLines: number }>()
    for (const row of stdout.split('\n')) {
      const [added, removed, path] = row.split('\t'), id = [...(path ?? '').matchAll(/([^/{}\s]+)\.txt/g)].map((match) => match[1]!).find((candidate) => known.has(candidate))
      if (id && /^\d+$/.test(added ?? '') && /^\d+$/.test(removed ?? '')) counts.set(id, { addedLines: Number(added), removedLines: Number(removed) })
    }
    return files.map((file) => file.binary ? file : { ...file, ...(counts.get(file.id) ?? { addedLines: 0, removedLines: 0 }) })
  } finally { await rm(temp, { recursive: true, force: true }) }
}
