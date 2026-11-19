import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Device-wide UI state: panel widths and similar choices that should look the same in every host's window. Each host
 * window has its own web storage, so these live here, in one small file, and reach every window through the
 * `device-state:changed` push event. Values are plain strings, like localStorage.
 */
const MAX_KEYS = 500
const MAX_KEY = 200
const MAX_VALUE = 64 * 1024
const KEY = /^ramu\.[A-Za-z0-9._:/@-]+$/

export type DeviceFiles = {
  read(file: string): string
  write(file: string, content: string): void
}
const nodeFiles: DeviceFiles = {
  read: (file) => readFileSync(file, 'utf8'),
  write: (file, content) => {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, content)
    renameSync(temporary, file)
  },
}

export class DeviceState {
  private readonly values = new Map<string, string>()
  private timer: NodeJS.Timeout | undefined
  private dirty = false

  constructor(
    private readonly file: string,
    private readonly files: DeviceFiles = nodeFiles,
    private readonly delayMs = 200,
  ) {
    try {
      const saved = JSON.parse(files.read(file)) as unknown
      if (saved && typeof saved === 'object' && !Array.isArray(saved))
        for (const [key, value] of Object.entries(saved))
          if (this.valid(key, value) && this.values.size < MAX_KEYS) this.values.set(key, value)
    } catch {
      // A missing or damaged file starts empty. The values are layout conveniences.
    }
  }

  private valid(key: unknown, value: unknown): value is string {
    return (
      typeof key === 'string' &&
      key.length <= MAX_KEY &&
      KEY.test(key) &&
      typeof value === 'string' &&
      value.length <= MAX_VALUE
    )
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values)
  }

  /** Returns whether the stored value changed. Invalid requests throw, so a compromised page cannot fill the disk. */
  set(key: unknown, value: unknown): boolean {
    if (value === null) {
      if (typeof key !== 'string' || !KEY.test(key)) throw new Error('Invalid device setting')
      if (!this.values.delete(key)) return false
    } else {
      if (!this.valid(key, value)) throw new Error('Invalid device setting')
      if (this.values.get(key as string) === value) return false
      if (!this.values.has(key as string) && this.values.size >= MAX_KEYS) throw new Error('Too many device settings')
      this.values.set(key as string, value)
    }
    this.dirty = true
    this.timer ??= setTimeout(() => this.flush(), this.delayMs)
    this.timer.unref?.()
    return true
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty) return
    this.dirty = false
    try {
      this.files.write(this.file, JSON.stringify(this.snapshot()))
    } catch {
      this.dirty = true
    }
  }
}
