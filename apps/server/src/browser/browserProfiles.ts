import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { isBuiltInProfile, validProfileId } from '@ramu/shared/browser'
import type { BrowserProfileCatalog, BrowserProfileInfo } from '@ramu/shared/types/browser'

interface SavedProfile {
  id: string
  name: string
  createdAt: number
  importedAt?: number
  /** An import in progress or awaiting Keep/Discard: hidden from agents and the catalog, never usable for a tab. */
  staged?: boolean
}
export interface BrowserProfileFiles {
  read(path: string): string
  write(path: string, text: string): void
}
const files: BrowserProfileFiles = {
  read(path) {
    if (statSync(path).size > 64000) throw new Error('Oversized browser profile catalog')
    return readFileSync(path, 'utf8')
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, text)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, path)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try {
        unlinkSync(temporary)
      } catch {
        /* The committed file replaced it, or the write failed before creation. */
      }
    }
  },
}
const cleanName = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Name the browser profile.')
  const name = value.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name))
    throw new Error('Use a profile name of 1 to 80 characters without control characters.')
  return name
}

/** Atomic local catalog. A damaged catalog never overwrites metadata for existing website identities. */
export class BrowserProfiles {
  private records: SavedProfile[] = []
  private readonly busy = new Set<string>()
  private error: string | undefined
  constructor(
    private readonly path: string,
    private readonly storage: BrowserProfileFiles = files,
  ) {
    try {
      const raw: unknown = JSON.parse(storage.read(path))
      const object = raw as { version?: unknown; profiles?: unknown }
      if (!object || object.version !== 1 || !Array.isArray(object.profiles) || object.profiles.length > 20)
        throw new Error('Invalid catalog')
      const seen = new Set<string>()
      const names = new Set<string>(['default', 'temporary', 'bawaan', 'sementara'])
      for (const value of object.profiles) {
        const profile = value as SavedProfile
        if (
          !profile ||
          !validProfileId(profile.id) ||
          isBuiltInProfile(profile.id) ||
          seen.has(profile.id) ||
          !Number.isSafeInteger(profile.createdAt) ||
          profile.createdAt < 0
        )
          throw new Error('Invalid profile')
        const name = cleanName(profile.name)
        if (names.has(name.toLowerCase())) throw new Error('Duplicate name')
        seen.add(profile.id)
        names.add(name.toLowerCase())
        this.records.push({
          id: profile.id,
          name,
          createdAt: profile.createdAt,
          ...(Number.isSafeInteger(profile.importedAt) && profile.importedAt! >= 0
            ? { importedAt: profile.importedAt }
            : {}),
          ...(profile.staged === true ? { staged: true } : {}),
        })
      }
    } catch (error) {
      this.records = []
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.error =
          'Browser profile metadata could not be read. Restore the profile catalog before adding or changing profiles; existing website data has not been removed.'
    }
  }

  catalog(): BrowserProfileCatalog {
    return {
      profiles: [
        { id: 'default', name: 'Default', builtin: true, temporary: false, createdAt: null },
        { id: 'temporary', name: 'Temporary', builtin: true, temporary: true, createdAt: null },
        ...this.records
          .filter((profile) => !profile.staged)
          .map(({ staged: _staged, ...profile }) => ({ ...profile, builtin: false, temporary: false })),
      ],
      ...(this.error ? { error: this.error } : {}),
    }
  }
  isBusy(id: string): boolean {
    return this.busy.has(id)
  }
  async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error('This browser profile is already being changed.')
    this.busy.add(id)
    try {
      return await operation()
    } finally {
      this.busy.delete(id)
    }
  }
  /** Profiles a tab may use. A staged import is not one of them. */
  ids(): string[] {
    return this.records.filter((profile) => !profile.staged).map((profile) => profile.id)
  }
  /** Imports that were never kept. Their website data is removed by the caller, then each is discarded. */
  stagedIds(): string[] {
    return this.records.filter((profile) => profile.staged).map((profile) => profile.id)
  }
  private save(next: SavedProfile[]) {
    if (this.error) throw new Error(this.error)
    this.storage.write(this.path, JSON.stringify({ version: 1, profiles: next }))
    this.records = next
  }
  private name(value: unknown, except?: string): string {
    const name = cleanName(value)
    if (
      this.catalog().profiles.some(
        (profile) => profile.id !== except && profile.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error('A browser profile already uses that name.')
    // A name held by a staged import is taken too, so Keep cannot collide later.
    if (this.records.some((profile) => profile.id !== except && profile.name.toLowerCase() === name.toLowerCase()))
      throw new Error('A browser profile already uses that name.')
    return name
  }
  create(value: unknown): BrowserProfileInfo {
    if (this.records.length >= 20) throw new Error('Remove a browser profile before adding another.')
    const profile = { id: randomUUID(), name: this.name(value), createdAt: Date.now() }
    this.save([...this.records, profile])
    return { ...profile, builtin: false, temporary: false }
  }
  /** A new hidden profile to receive imported sessions. It counts toward the profile limit while it exists. */
  stage(value: unknown): BrowserProfileInfo {
    if (this.records.length >= 20) throw new Error('Remove a browser profile before adding another.')
    const name = this.name(value)
    const profile = { id: randomUUID(), name, createdAt: Date.now(), staged: true as const }
    this.save([...this.records, profile])
    return { id: profile.id, name, createdAt: profile.createdAt, builtin: false, temporary: false }
  }
  /** Makes a staged import a normal profile. Fails if its name was taken in the meantime. */
  keep(id: string): BrowserProfileInfo {
    const staged = this.requireStaged(id)
    const name = this.name(staged.name, id)
    const importedAt = Date.now()
    this.save(
      this.records.map((profile) =>
        profile.id === id ? { id, name, createdAt: profile.createdAt, importedAt } : profile,
      ),
    )
    return { id, name, createdAt: staged.createdAt, importedAt, builtin: false, temporary: false }
  }
  /** Removes a staged import's record. Clearing its website data is the caller's job and comes first. */
  discard(id: string): void {
    this.requireStaged(id)
    this.save(this.records.filter((profile) => profile.id !== id))
  }
  private requireStaged(id: string): SavedProfile {
    if (this.error) throw new Error(this.error)
    const staged = this.records.find((profile) => profile.id === id && profile.staged)
    if (!validProfileId(id) || !staged) throw new Error('That import is no longer waiting to be kept.')
    return staged
  }
  rename(id: string, value: unknown): void {
    this.requireCustom(id)
    if (this.busy.has(id)) throw new Error('This browser profile is already being changed.')
    const name = this.name(value, id)
    this.save(this.records.map((profile) => (profile.id === id ? { ...profile, name } : profile)))
  }
  requireCustom(id: string): void {
    if (this.error) throw new Error(this.error)
    if (
      !validProfileId(id) ||
      isBuiltInProfile(id) ||
      !this.records.some((profile) => profile.id === id && !profile.staged)
    )
      throw new Error('That browser profile cannot be changed or is no longer available.')
  }
  remove(id: string): void {
    this.requireCustom(id)
    this.save(this.records.filter((profile) => profile.id !== id))
  }
}
