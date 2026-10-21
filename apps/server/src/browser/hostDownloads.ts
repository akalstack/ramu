import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CDPSession } from 'playwright-core'
import type { GuestDownload } from './browserDownloads'
import type { GuestHandlers } from './browserRuntime'

/** Fixed Chromium download protocol adapter; raw files are GUID-named inside a private host directory. */
export class HostDownloads {
  private entries = new Map<string, { received: number; total: number; path?: string; cancelled: boolean; updated: (() => void)[]; done: ((state: 'completed' | 'cancelled' | 'interrupted') => void)[] }>()
  constructor(private readonly cdp: CDPSession, private readonly directory: string, handlers: (frameId: string) => GuestHandlers | undefined) {
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    cdp.on('Browser.downloadWillBegin', event => {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(event.guid)) return
      const entry = { received: 0, total: 0, cancelled: false, updated: [] as (() => void)[], done: [] as ((state: 'completed' | 'cancelled' | 'interrupted') => void)[], path: undefined as string | undefined }
      this.entries.set(event.guid, entry)
      const item: GuestDownload = {
        name: () => event.suggestedFilename, received: () => entry.received, total: () => entry.total,
        saveTo: path => { entry.path = path },
        cancel: () => {
          if (entry.cancelled) return
          entry.cancelled = true
          void cdp.send('Browser.cancelDownload', { guid: event.guid }).catch(() => {}).finally(() => {
            this.entries.delete(event.guid)
            this.erase(event.guid)
            for (const done of entry.done) done('cancelled')
          })
        },
        updated: callback => { entry.updated.push(callback) }, done: callback => { entry.done.push(callback) },
      }
      try { if (!handlers(event.frameId)?.onDownload?.(item)) item.cancel() }
      catch { item.cancel() }
    })
    cdp.on('Browser.downloadProgress', event => {
      const entry = this.entries.get(event.guid)
      if (!entry || entry.cancelled) return
      entry.received = event.receivedBytes
      entry.total = event.totalBytes
      for (const updated of entry.updated) updated()
      if (entry.cancelled || event.state === 'inProgress') return
      this.entries.delete(event.guid)
      let state: 'completed' | 'interrupted' = 'interrupted'
      if (event.state === 'completed' && entry.path) {
        try { renameSync(join(directory, event.guid), entry.path); state = 'completed' } catch {}
      }
      this.erase(event.guid)
      for (const done of entry.done) done(state)
    })
  }
  private erase(guid: string) { try { rmSync(join(this.directory, guid), { force: true }) } catch {} }
  async enable(browserContextId?: string): Promise<void> {
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: this.directory, eventsEnabled: true, ...(browserContextId ? { browserContextId } : {}) })
  }
}
