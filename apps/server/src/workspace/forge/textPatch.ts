import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
const exec = promisify(execFile)

/**
 * The unified hunks between two versions of a file, shaped as the services that do return diffs send them: no file
 * header, three lines of context. For a service that gives only the two texts; git computes the diff, never the shell.
 */
export async function textPatch(
  before: string,
  after: string,
): Promise<{ patch: string | null; additions: number; deletions: number }> {
  if (before === after) return { patch: null, additions: 0, deletions: 0 }
  const temp = await mkdtemp(join(tmpdir(), 'ramu-patch-'))
  try {
    const a = join(temp, 'a'),
      b = join(temp, 'b')
    await writeFile(a, before)
    await writeFile(b, after)
    let stdout: string
    try {
      stdout = (
        await exec(
          'git',
          [
            '-c',
            'color.ui=false',
            'diff',
            '--no-index',
            '--unified=3',
            '--no-ext-diff',
            '--no-textconv',
            '--text',
            '--',
            a,
            b,
          ],
          { timeout: 20_000, maxBuffer: 8_000_000 },
        )
      ).stdout
    } catch (error) {
      // git diff --no-index exits 1 when the files differ, which is the answer, not a failure.
      const diff = error as { code?: number; stdout?: string }
      if (diff.code !== 1 || typeof diff.stdout !== 'string') throw error
      stdout = diff.stdout
    }
    const start = stdout.indexOf('\n@@')
    const patch = start < 0 ? '' : stdout.slice(start + 1).replace(/\n$/, '')
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+')) additions++
      else if (line.startsWith('-')) deletions++
    }
    return { patch: patch || null, additions, deletions }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
