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

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** A file's text when it has a readable diff, or undefined for binary, invalid UTF-8 or files over 1 MB. */
export function reviewText(bytes: Uint8Array): string | undefined {
  if (bytes.length > 1_000_000 || bytes.includes(0)) return
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return
  }
}

/**
 * A file's bytes once no write is landing on it. Agents and editors rewrite files in place, so a read can catch one half
 * written, cut through a multi-byte character, and make a text file look binary for the rest of the review. A read that
 * changed under it, or a just-written file that does not decode, is read again.
 */
export async function readSettledFile(absolute: string): Promise<Buffer> {
  let bytes = Buffer.alloc(0)
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 50))
    const before = await stat(absolute)
    bytes = await readFile(absolute)
    const after = await stat(absolute)
    const steady = before.mtimeMs === after.mtimeMs && after.size === bytes.length
    if (steady && (Date.now() - after.mtimeMs > 2000 || reviewText(bytes) !== undefined)) break
  }
  return bytes
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
    const bytes = await readSettledFile(absolute)
    const content = reviewText(bytes)
    return { hash: hashOf(bytes), content: content ?? '', binary: content === undefined }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
