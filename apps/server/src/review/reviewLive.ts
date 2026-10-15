import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { hashOf, resolveInRoot } from '../workspace/files'
const exec = promisify(execFile)

export interface ReviewCheckout {
  head?: string
  branch?: string
}
export async function reviewCheckout(cwd: string): Promise<ReviewCheckout> {
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 })
    const [head, branch] = stdout.trim().split('\n')
    return { head, branch }
  } catch {
    // An unborn branch has a symbolic HEAD even though no commit exists yet.
    try {
      const { stdout } = await exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, timeout: 5000 })
      return { branch: stdout.trim() || undefined }
    } catch {
      return {}
    }
  }
}

/** Only Git's explicit rename records are used for automatic relocation. */
export async function reviewRenames(cwd: string, head?: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const args of [
    head ? ['diff', '--name-status', '-z', '-M', head, 'HEAD'] : [],
    ['diff', '--name-status', '-z', '-M', 'HEAD'],
  ]) {
    if (!args.length) continue
    try {
      const { stdout } = await exec('git', args, { cwd, timeout: 5000, maxBuffer: 4_000_000 })
      const fields = stdout.split('\0')
      for (let index = 0; index < fields.length;) {
        const status = fields[index++]
        if (!status) break
        const from = fields[index++]
        if (status.startsWith('R') || status.startsWith('C')) {
          const to = fields[index++]
          if (status.startsWith('R') && from && to) {
            for (const [original, destination] of result) if (destination === from) result.set(original, to)
            result.set(from, to)
          }
        }
      }
    } catch {
      /* Non-Git folders and expired commits still support snapshot review. */
    }
  }
  return result
}

export async function readReviewCurrent(
  cwd: string,
  path: string,
): Promise<{ hash: string; content: string; binary: boolean } | null> {
  const absolute = await resolveInRoot(cwd, path)
  try {
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('This path is no longer a file')
    if (info.size > 50_000_000) return { hash: `${info.size}:${info.mtimeMs}`, content: '', binary: true }
    const bytes = await readFile(absolute)
    const binary = bytes.length > 1_000_000 || bytes.includes(0) || bytes.toString('utf8').includes('\ufffd')
    return { hash: hashOf(bytes), content: binary ? '' : bytes.toString('utf8'), binary }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
