import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, openSync, readSync, closeSync, copyFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { BROWSER_UPLOAD_CHUNK_BYTES, type BrowserDownloadInfo } from '@ramu/shared/browserBridge'
import type { UploadOwner } from './browserUploads'

const LIMIT = 32 * 1024 * 1024
/** Narrow adapter: filenames and paths from a website never become filesystem authority. */
export interface GuestDownload {
  name(): string
  total(): number
  received(): number
  saveTo(path: string): void
  cancel(): void
  updated(callback: () => void): void
  done(callback: (state: BrowserDownloadInfo['state']) => void): void
}
interface Entry {
  owner: UploadOwner
  info: BrowserDownloadInfo
  path: string
  item: GuestDownload
  timer: NodeJS.Timeout
}
const same = (a: UploadOwner, b: UploadOwner) =>
  a.hostId === b.hostId &&
  a.threadId === b.threadId &&
  a.tabId === b.tabId &&
  a.runId === b.runId &&
  a.generation === b.generation

/** Downloads require a one-use, one-minute grant and expire after an hour. Staging is private to this device. */
export class BrowserDownloads {
  private enabled = true
  private cleanupFailed = false
  private readonly grants = new Map<string, { owner: UploadOwner; expires: number }>()
  private readonly entries = new Map<string, Entry>()
  constructor(
    private readonly root: string,
    private readonly changed: () => void = () => {},
  ) {
    // No downloads survive a restart. Only this dedicated staging directory is removed.
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 })
      mkdirSync(root, { recursive: true, mode: 0o700 })
      chmodSync(root, 0o700)
    } catch {
      this.enabled = false
      this.cleanupFailed = true
    }
  }
  warning(): string | undefined {
    return this.cleanupFailed
      ? 'Browser download staging could not be cleaned. Restart Ramu to retry; unsaved files are never opened automatically.'
      : undefined
  }
  private erase(path: string): void {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      this.cleanupFailed = true
    }
  }
  prepare(owner: UploadOwner): void {
    if (!this.enabled)
      throw new Error('Browser download staging is unavailable. Check device storage and restart Ramu.')
    this.grants.set(owner.tabId, { owner: { ...owner }, expires: Date.now() + 60_000 })
  }
  accept(owner: UploadOwner, item: GuestDownload): boolean {
    if (!this.enabled) return false
    const grant = this.grants.get(owner.tabId)
    this.grants.delete(owner.tabId)
    if (!grant || grant.expires < Date.now() || !same(grant.owner, owner)) return false
    if (
      item.total() > LIMIT ||
      this.entries.size >= 20 ||
      [...this.entries.values()].filter((e) => e.info.state === 'progressing').length >= 2
    )
      return false
    const id = randomUUID()
    const path = join(this.root, id)
    const name =
      item
        .name()
        .replace(/[\/\\\x00-\x1f\x7f]/g, '_')
        .slice(0, 255) || 'download'
    const info: BrowserDownloadInfo = {
      id,
      tabId: owner.tabId,
      name,
      state: 'progressing',
      received: 0,
      total: Math.max(0, item.total()),
    }
    const timer = setTimeout(() => this.cancelEntry(id), 120_000)
    timer.unref()
    const entry: Entry = { owner: { ...owner }, info, path, item, timer }
    let notified = 0
    this.entries.set(id, entry)
    try {
      item.saveTo(path)
    } catch {
      this.remove(id)
      return false
    }
    item.updated(() => {
      if (info.state !== 'progressing') return
      info.received = item.received()
      info.total = Math.max(0, item.total())
      if (info.received > LIMIT || info.total > LIMIT) this.cancelEntry(id)
      if (Date.now() - notified >= 250) {
        notified = Date.now()
        this.changed()
      }
    })
    item.done((state) => {
      if (!this.entries.has(id)) return
      clearTimeout(entry.timer)
      info.received = item.received()
      info.state = info.state === 'cancelled' ? 'cancelled' : state
      if (info.received > LIMIT) info.state = 'cancelled'
      if (info.state !== 'completed') this.erase(path)
      entry.timer = setTimeout(() => this.remove(id), 60 * 60_000)
      entry.timer.unref()
      this.changed()
    })
    this.changed()
    return true
  }
  list(hostId: string, threadId: string, tabId?: string): BrowserDownloadInfo[] {
    return [...this.entries.values()]
      .filter((e) => e.owner.hostId === hostId && e.owner.threadId === threadId && (!tabId || e.owner.tabId === tabId))
      .map((e) => ({ ...e.info }))
  }
  private owned(id: string, hostId: string, threadId: string): Entry {
    const entry = this.entries.get(id)
    if (!entry || entry.owner.hostId !== hostId || entry.owner.threadId !== threadId)
      throw new Error('That browser download expired or belongs to another thread.')
    return entry
  }
  read(id: string, owner: UploadOwner, offset: number) {
    const entry = this.owned(id, owner.hostId, owner.threadId)
    if (!same(entry.owner, owner))
      throw new Error('Browser control changed. Review and save this download from the browser pane.')
    return this.readOwned(id, owner.hostId, owner.threadId, offset)
  }
  readOwned(id: string, hostId: string, threadId: string, offset: number) {
    const entry = this.owned(id, hostId, threadId)
    if (entry.info.state !== 'completed') throw new Error('The download has not completed.')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.info.received)
      throw new Error('Invalid download offset.')
    const fd = openSync(entry.path, 'r')
    try {
      const bytes = Buffer.alloc(Math.min(BROWSER_UPLOAD_CHUNK_BYTES, entry.info.received - offset))
      const read = readSync(fd, bytes, 0, bytes.length, offset)
      return { data: bytes.subarray(0, read).toString('base64'), offset, size: entry.info.received }
    } finally {
      closeSync(fd)
    }
  }
  save(id: string, hostId: string, threadId: string, path: string): void {
    const entry = this.owned(id, hostId, threadId)
    if (entry.info.state !== 'completed') throw new Error('The download has not completed.')
    copyFileSync(entry.path, path)
  }
  cancel(id: string, hostId: string, threadId: string): void {
    this.owned(id, hostId, threadId)
    this.cancelEntry(id)
  }
  private cancelEntry(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.info.state === 'progressing') {
      entry.info.state = 'cancelled'
      entry.item.cancel()
    }
    this.remove(id)
    this.changed()
  }
  private remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.entries.delete(id)
    this.erase(entry.path)
  }
  revoke(tabId: string): void {
    this.grants.delete(tabId)
    for (const [id, entry] of this.entries)
      if (entry.owner.tabId === tabId && entry.info.state === 'progressing') this.cancelEntry(id)
  }
  endRun(hostId: string, threadId: string, runId: string): void {
    for (const [tabId, grant] of this.grants)
      if (grant.owner.hostId === hostId && grant.owner.threadId === threadId && grant.owner.runId === runId)
        this.grants.delete(tabId)
    for (const [id, entry] of this.entries)
      if (
        entry.owner.hostId === hostId &&
        entry.owner.threadId === threadId &&
        entry.owner.runId === runId &&
        entry.info.state === 'progressing'
      )
        this.cancelEntry(id)
  }
  close(): void {
    this.enabled = false
    this.grants.clear()
    for (const id of this.entries.keys()) this.cancelEntry(id)
    this.erase(this.root)
  }
}
