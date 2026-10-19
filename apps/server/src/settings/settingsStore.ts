import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_APP_PREFERENCES, type AppPreferences, type ModelPreferences } from '@ramu/shared/types'
import { appPreferences, modelPreferences } from '../ipc/preferences'

type Document = Record<string, unknown> & { models?: ModelPreferences | null }
const MAX_BYTES = 2 * 1024 * 1024

/** Host-owned user configuration. Runtime state and the migration archive stay in SQLite. */
export class SettingsStore {
  private document: Document = {}
  private watcher?: FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private listeners = new Set<() => void>()
  readonly path: string

  constructor(
    directory: string,
    legacy: { preferences: unknown; models: unknown },
    private warn = () => console.warn('Invalid settings.json; keeping the last valid settings.'),
  ) {
    this.path = join(directory, 'settings.json')
    this.document = this.validate({})
    mkdirSync(directory, { recursive: true })
    if (!existsSync(this.path)) {
      try {
        this.document = this.validate({ ...((legacy.preferences as object) ?? {}), models: legacy.models ?? null })
      } catch {
        this.warn()
      }
      this.write(this.document)
    } else {
      try {
        this.document = this.read()
      } catch {
        this.warn()
      }
    }
    // Watch the directory so editor atomic-renames do not detach the watch from the file.
    this.watcher = watch(directory, { persistent: false }, (_event, name) => {
      if (name !== null && name.toString() !== 'settings.json') return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.reload(), 80)
      this.timer.unref()
    })
    this.watcher.on('error', () => this.warn())
  }

  private validate(value: unknown): Document {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings document')
    const raw = value as Document
    const preferences = appPreferences.parse({
      ...DEFAULT_APP_PREFERENCES,
      ...raw,
      ...(raw.messageBehaviorVersion === 4 ? {} : { busyMessageAction: 'steer', messageBehaviorVersion: 4 }),
    })
    const models = raw.models == null ? null : modelPreferences.parse(raw.models)
    return {
      ...raw,
      ...preferences,
      models: models ? { ...models, defaultBarMode: models.defaultBarMode === 'effort' ? 'effort' : 'model' } : null,
    }
  }

  private read(): Document {
    if (statSync(this.path).size > MAX_BYTES) throw new Error('Settings file is too large')
    return this.validate(JSON.parse(readFileSync(this.path, 'utf8')))
  }

  private write(document: Document) {
    const temporary = `${this.path}.tmp.${randomUUID()}`
    const text = JSON.stringify(document, null, 2) + '\n'
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Settings file is too large')
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, text)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      if (readFileSync(temporary, 'utf8') !== text) throw new Error('Settings write verification failed')
      renameSync(temporary, this.path)
      const directory = openSync(dirname(this.path), 'r')
      try {
        fsyncSync(directory)
      } finally {
        closeSync(directory)
      }
    } finally {
      try {
        unlinkSync(temporary)
      } catch {}
    }
  }

  reload() {
    try {
      const next = this.read()
      if (JSON.stringify(next) === JSON.stringify(this.document)) return
      this.document = next
      for (const listener of this.listeners) listener()
    } catch {
      this.warn()
    }
  }

  preferences(): AppPreferences {
    this.reload()
    return appPreferences.parse(this.document)
  }
  models(): ModelPreferences | null {
    this.reload()
    return structuredClone(this.document.models ?? null)
  }

  /** Re-read before a UI save so unrelated external edits survive. Invalid manual edits are never overwritten. */
  set(preferences?: unknown, models?: unknown) {
    const current = existsSync(this.path) ? this.read() : this.document
    const next = this.validate({
      ...current,
      ...(preferences === undefined ? {} : (preferences as object)),
      ...(models === undefined ? {} : { models }),
    })
    this.write(next)
    this.document = next
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  close() {
    clearTimeout(this.timer)
    this.watcher?.close()
    this.listeners.clear()
  }
}
