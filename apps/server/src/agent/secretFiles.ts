import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SECRET_FILE_TTL_MS = 24 * 60 * 60 * 1000
const NAME = /^[0-9a-f]{32}(\.partial)?$/

/** Secrets a person gave a thread, each in its own owner-only file that the agent's commands read.
 * Values never enter events, the database or model context; files are removed after a day. */
export class SecretFiles {
  private sweeper?: NodeJS.Timeout

  constructor(readonly directory: string) {}

  async write(value: string): Promise<string> {
    if (!value || Buffer.byteLength(value) > 64 * 1024) throw new Error('Enter a secret of at most 64 KB')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const file = join(this.directory, randomBytes(16).toString('hex'))
    const partial = `${file}.partial`
    try {
      // `wx` never follows or replaces an existing path; the rename publishes only a complete file.
      await writeFile(partial, value, { flag: 'wx', mode: 0o600 })
      await rename(partial, file)
    } catch (error) {
      await rm(partial, { force: true }).catch(() => {})
      throw error
    }
    return file
  }

  async sweep(now = Date.now()): Promise<number> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch {
      return 0
    }
    let removed = 0
    for (const name of names) {
      if (!NAME.test(name)) continue
      const file = join(this.directory, name)
      try {
        if (now - (await stat(file)).mtimeMs <= SECRET_FILE_TTL_MS) continue
        await rm(file, { force: true })
        removed++
      } catch {
        /* Gone already, or unreadable; the next sweep tries again. */
      }
    }
    return removed
  }

  /** Sweeps now and then hourly, without keeping the process alive. */
  start(): void {
    void this.sweep()
    this.sweeper ??= setInterval(() => void this.sweep(), 60 * 60 * 1000)
    this.sweeper.unref()
  }

  stop(): void {
    clearInterval(this.sweeper)
    this.sweeper = undefined
  }
}
