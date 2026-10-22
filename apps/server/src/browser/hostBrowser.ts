import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import type { BrowserBridgeCommand, BrowserBridgeRequest, BrowserHumanInput } from '@ramu/shared/browserBridge'
import { BrowserProfiles } from './browserProfiles'
import { BrowserRuntime } from './browserRuntime'
import { executeBrowserBridge } from './browserBridge'
import { HostGuestFactory } from './hostGuest'
import { BrowserDownloads } from './browserDownloads'
import { randomUUID } from 'node:crypto'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'

const HOST = 'execution-host'
/** A viewer frame larger than this (base64 characters, about 3 MB of image) is refused rather than streamed to a phone. */
export const MAX_VIEWER_FRAME_CHARS = 4 * 1024 * 1024
export interface HostedBrowserBackend {
  prepare?(): Promise<void>
  selected(): boolean
  status(): { available: boolean; location: 'execution-host-chromium'; reason?: string }
  request(threadId: string, runId: string, command: BrowserBridgeCommand): Promise<unknown>
  endRun(threadId: string, runId: string): void
}
/** Host-owned browser. Paired owner devices share terminal-style access; tabs remain scoped to their thread. */
export class HostBrowser implements HostedBrowserBackend {
  private enabled = true
  private readonly profiles: BrowserProfiles
  private factory?: HostGuestFactory
  private runtime?: BrowserRuntime
  private preparation?: Promise<void>
  private setupEpoch = 0
  private setupAbort?: AbortController
  private reason = 'The browser starts automatically when you open a tab.'
  private readonly grants = new Map<string, { device: string; thread: string; expires: number }>()
  private readonly heartbeats = new Map<string, NodeJS.Timeout>()
  private captures = 0
  private readonly frameTimes = new Map<string, number>()
  private readonly pending = new Map<symbol, { thread: string; run: string; cancel(): void }>()
  private readonly profileReviews = new Map<
    string,
    { id: string; name: string; remove: boolean; tabs: string; expires: number }
  >()
  constructor(
    private readonly root: string,
    private readonly changed: () => void,
    private readonly present: (tab: BrowserTabInfo) => void = () => {},
    private readonly ownerDevice: (device: string) => boolean = () => false,
  ) {
    this.profiles = new BrowserProfiles(join(root, 'profiles.json'))
    try {
      this.enabled = readFileSync(join(root, 'enabled'), 'utf8') === '1'
    } catch {}
  }
  selected() {
    return this.enabled
  }
  async prepare(): Promise<void> {
    if (!this.enabled) throw new Error('The host browser is turned off. Turn it on in Browser settings.')
    await this.setup()
  }
  status() {
    return {
      available: !!this.runtime,
      enabled: this.enabled,
      location: 'execution-host-chromium' as const,
      ...(!this.runtime ? { reason: this.reason } : {}),
    }
  }
  setup(): Promise<void> {
    this.preparation ??= this.initialize().finally(() => {
      this.preparation = undefined
    })
    return this.preparation
  }
  private async initialize(): Promise<void> {
    if (this.runtime) return
    const abort = new AbortController()
    this.setupAbort = abort
    const epoch = this.setupEpoch
    try {
      // Use an explicitly administered path or Playwright's installed compatible Chromium, never an agent path.
      const executable = process.env.RAMU_BROWSER_EXECUTABLE || chromium.executablePath()
      if (!existsSync(executable)) {
        if (process.env.RAMU_BROWSER_EXECUTABLE)
          throw new Error(
            'RAMU_BROWSER_EXECUTABLE does not name an installed browser. Correct it on the owning host and retry Setup.',
          )
        this.reason = 'Downloading compatible Chromium on the execution host…'
        this.changed()
        const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js')
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 150_000,
            signal: abort.signal,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          })
          child.once('error', () =>
            reject(new Error('Chromium download could not start. Retry Setup on the owning host.')),
          )
          child.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(
                  new Error(
                    'Chromium installation did not finish. Check host storage and network access, then retry Setup.',
                  ),
                ),
          )
        })
        if (!existsSync(executable))
          throw new Error('The Chromium installer finished without its executable. Retry Setup on the owning host.')
      }
      const factory = new HostGuestFactory(join(this.root, 'profiles'), executable)
      try {
        await factory.preflight()
      } catch {
        await factory.close()
        throw new Error(
          'Chromium could not start with its sandbox enabled. Check host permissions and dependencies, then retry Setup.',
        )
      }
      if (epoch !== this.setupEpoch) {
        await factory.close()
        throw new Error('Host browser setup was cancelled.')
      }
      try {
        mkdirSync(this.root, { recursive: true, mode: 0o700 })
        writeFileSync(join(this.root, 'enabled'), '1', { mode: 0o600 })
      } catch (error) {
        await factory.close()
        throw error
      }
      this.factory = factory
      this.runtime = new BrowserRuntime(
        factory,
        () => this.profiles.ids(),
        this.changed,
        (id) => !this.profiles.isBusy(id),
        new BrowserDownloads(join(this.root, 'downloads'), this.changed),
      )
      this.enabled = true
      this.reason = ''
      this.changed()
    } catch (error) {
      this.reason = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (this.setupAbort === abort) this.setupAbort = undefined
    }
  }
  private ready(): BrowserRuntime {
    if (!this.runtime) throw new Error(this.reason)
    return this.runtime
  }
  async request(threadId: string, runId: string, command: BrowserBridgeCommand): Promise<unknown> {
    if (this.pending.size >= 8) throw new Error('The host browser is busy. Wait for its current operations.')
    return new Promise((resolve, reject) => {
      const key = Symbol()
      const finish = (error?: Error, value?: unknown) => {
        if (!this.pending.delete(key)) return
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(
        () => finish(new Error('The browser operation timed out and may have run. Inspect before acting again.')),
        30_000,
      )
      timer.unref()
      this.pending.set(key, {
        thread: threadId,
        run: runId,
        cancel: () => finish(new Error('The browser run ended. Inspect before acting again.')),
      })
      void this.prepare()
        .then(() => {
          if (!this.pending.has(key)) return
          return executeBrowserBridge(
            this.ready(),
            HOST,
            {
              requestId: 'host-runtime',
              clientId: 'host-runtime',
              threadId,
              runId,
              expiresAt: Date.now() + 30_000,
              command,
            } satisfies BrowserBridgeRequest,
            () => this.profiles.catalog(),
          )
        })
        .then(
          (value) => {
            if (this.pending.has(key)) {
              if (command.kind === 'present' && value) this.present(value as BrowserTabInfo)
              else if (command.kind === 'open' && command.presentation === 'foreground' && value)
                this.present((value as { tab: BrowserTabInfo }).tab)
            }
            finish(undefined, value)
          },
          (error) => finish(error instanceof Error ? error : new Error('Browser operation failed.')),
        )
    })
  }
  endRun(threadId: string, runId: string): void {
    for (const operation of [...this.pending.values()])
      if (operation.thread === threadId && operation.run === runId) operation.cancel()
    this.runtime?.endRun({ hostId: HOST, threadId, runId })
  }
  catalog() {
    return this.profiles.catalog()
  }
  createProfile(name: string) {
    const profile = this.profiles.create(name)
    this.changed()
    return profile
  }
  renameProfile(id: string, name: string) {
    this.profiles.rename(id, name)
    this.changed()
  }
  reviewProfile(id: string, remove: boolean) {
    if (remove) this.profiles.requireCustom(id)
    const profile = this.catalog().profiles.find((profile) => profile.id === id && !profile.temporary)
    if (!profile) throw new Error('Choose a persistent browser profile.')
    for (const [token, review] of this.profileReviews)
      if (review.expires < Date.now()) this.profileReviews.delete(token)
    if (this.profileReviews.size >= 20) throw new Error('Finish the pending profile reviews first.')
    const tabs = this.ready()
      .list()
      .filter((tab) => tab.profileId === id)
      .map((tab) => tab.id)
      .sort()
      .join(',')
    const token = randomUUID()
    this.profileReviews.set(token, { id, name: profile.name, remove, tabs, expires: Date.now() + 5 * 60_000 })
    return { token, id, name: profile.name, tabs: tabs ? tabs.split(',').length : 0, remove }
  }
  async confirmProfile(token: string, resetDefault: (id: string) => Promise<void>): Promise<void> {
    const review = this.profileReviews.get(token)
    this.profileReviews.delete(token)
    if (!review || review.expires < Date.now()) throw new Error('Review this profile change again.')
    const runtime = this.ready()
    const current = runtime
      .list()
      .filter((tab) => tab.profileId === review.id)
      .map((tab) => tab.id)
      .sort()
      .join(',')
    if (
      current !== review.tabs ||
      this.catalog().profiles.find((profile) => profile.id === review.id)?.name !== review.name
    )
      throw new Error('The profile or its tabs changed. Review the action again.')
    await this.profiles.withLock(review.id, () =>
      runtime.withClosedProfile(review.id, async () => {
        await this.factory!.clearProfile(review.id)
        if (review.remove) {
          await resetDefault(review.id)
          this.profiles.remove(review.id)
        }
      }),
    )
    this.changed()
  }
  downloads(device: string, thread: string) {
    return this.authorized(device, thread).listDownloads({ hostId: HOST, threadId: thread })
  }
  allowDownload(device: string, thread: string, tabId: string) {
    return this.controlled(device, thread, tabId).prepareHumanDownload(tabId, { hostId: HOST, threadId: thread })
  }
  readDownload(device: string, thread: string, downloadId: string, offset: number) {
    return this.authorized(device, thread).readDownloadAsHuman(downloadId, { hostId: HOST, threadId: thread }, offset)
  }
  cancelDownload(device: string, thread: string, downloadId: string) {
    return this.authorized(device, thread).cancelDownload(downloadId, { hostId: HOST, threadId: thread })
  }
  async open(device: string, thread: string, url: string, profileId?: string) {
    const runtime = this.authorized(device, thread)
    this.touch(device)
    return runtime.open({ hostId: HOST, threadId: thread }, url, profileId, { kind: 'human', deviceId: device })
  }
  private controlled(device: string, thread: string, tabId: string) {
    const runtime = this.authorized(device, thread)
    runtime.requireHumanDevice(tabId, device, { hostId: HOST, threadId: thread })
    this.touch(device)
    return runtime
  }
  closeTab(device: string, thread: string, tabId: string): void {
    this.controlled(device, thread, tabId).close(tabId)
  }
  history(device: string, thread: string, tabId: string, direction: 'back' | 'forward' | 'reload') {
    return this.controlled(device, thread, tabId)[direction](tabId)
  }
  dialog(device: string, thread: string, tabId: string) {
    return this.authorized(device, thread).dialogForAgent(tabId, { hostId: HOST, threadId: thread })
  }
  answerDialog(device: string, thread: string, tabId: string, dialogId: string, accept: boolean, text?: string) {
    return this.controlled(device, thread, tabId).handleDialogAsHuman(tabId, dialogId, accept, text, device)
  }
  grant(device: string, thread: string): void {
    this.ready()
    for (const grant of this.grants.values()) if (grant.expires <= Date.now()) this.revoke(grant.device, grant.thread)
    if (this.grants.size >= 100 && !this.grants.has(JSON.stringify([device, thread])))
      throw new Error('Remove a browser device grant before adding another.')
    this.grants.set(JSON.stringify([device, thread]), { device, thread, expires: Date.now() + 60 * 60_000 })
  }
  grantsList() {
    return [...this.grants.values()].filter((grant) => grant.expires > Date.now()).map((grant) => ({ ...grant }))
  }
  revoke(device: string, thread: string): void {
    this.grants.delete(JSON.stringify([device, thread]))
    this.runtime?.controllerDisconnected(device)
    const timer = this.heartbeats.get(device)
    if (timer) clearTimeout(timer)
    this.heartbeats.delete(device)
  }
  private authorized(device: string, thread: string): BrowserRuntime {
    if (device !== 'local' && !this.ownerDevice(device)) {
      const grant = this.grants.get(JSON.stringify([device, thread]))
      if (!grant || grant.expires <= Date.now()) {
        this.revoke(device, thread)
        throw new Error(
          'Browser viewing is not granted for this device and thread. Ask the owning host to grant it in Browser settings.',
        )
      }
    }
    return this.ready()
  }
  private touch(device: string): void {
    const previous = this.heartbeats.get(device)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.heartbeats.delete(device)
      this.runtime?.controllerDisconnected(device)
      this.frameTimes.delete(device)
    }, 5000)
    timer.unref()
    this.heartbeats.set(device, timer)
  }
  list(device: string, thread: string) {
    const runtime = this.authorized(device, thread)
    this.touch(device)
    return runtime.list({ hostId: HOST, threadId: thread })
  }
  read(device: string, thread: string, tabId: string) {
    return this.authorized(device, thread).inspectForAgent(tabId, 'viewer', { hostId: HOST, threadId: thread })
  }
  upload(
    device: string,
    thread: string,
    tabId: string,
    generation: number,
    snapshot: number,
    ref: number,
    file: { name: string; data: string },
  ) {
    return this.authorized(device, thread).uploadAsHuman(
      tabId,
      device,
      generation,
      { hostId: HOST, threadId: thread },
      snapshot,
      ref,
      file,
    )
  }
  async frame(device: string, thread: string, tabId: string) {
    const runtime = this.authorized(device, thread)
    this.touch(device)
    const now = Date.now()
    if (this.captures >= 2 || now - (this.frameTimes.get(device) ?? 0) < 450)
      throw new Error('Wait before requesting another browser frame.')
    this.frameTimes.set(device, now)
    this.captures++
    try {
      const image = await runtime.captureForViewer(tabId, { hostId: HOST, threadId: thread })
      if (image.data.length > MAX_VIEWER_FRAME_CHARS)
        throw new Error('This page is too large to stream. Make the page smaller and try again.')
      return image
    } finally {
      this.captures--
    }
  }
  take(device: string, thread: string, tabId: string) {
    const runtime = this.authorized(device, thread)
    if (!runtime.list({ hostId: HOST, threadId: thread }).some((tab) => tab.id === tabId))
      throw new Error('That tab belongs to another thread.')
    const tab = runtime.takeControl(tabId, device, { local: device === 'local' })
    this.touch(device)
    return tab
  }
  release(device: string, thread: string, tabId: string, runId?: string) {
    const runtime = this.authorized(device, thread)
    if (!runtime.list({ hostId: HOST, threadId: thread }).some((tab) => tab.id === tabId))
      throw new Error('That tab belongs to another thread.')
    return runId ? runtime.giveToAgent(tabId, device, runId) : runtime.releaseForNextRun(tabId, device)
  }
  async input(device: string, thread: string, tabId: string, generation: number, input: BrowserHumanInput) {
    const runtime = this.authorized(device, thread)
    this.touch(device)
    await runtime.inputAsHuman(tabId, device, generation, { hostId: HOST, threadId: thread }, input)
  }
  async navigate(device: string, thread: string, tabId: string, url: string) {
    return this.controlled(device, thread, tabId).navigate(tabId, url)
  }
  disconnect(device: string): void {
    this.runtime?.controllerDisconnected(device)
    const timer = this.heartbeats.get(device)
    if (timer) clearTimeout(timer)
    this.heartbeats.delete(device)
  }
  async close(): Promise<void> {
    this.setupEpoch++
    this.setupAbort?.abort()
    for (const operation of [...this.pending.values()]) operation.cancel()
    for (const timer of this.heartbeats.values()) clearTimeout(timer)
    this.heartbeats.clear()
    this.grants.clear()
    this.frameTimes.clear()
    this.profileReviews.clear()
    this.runtime?.closeAll()
    this.runtime = undefined
    const factory = this.factory
    this.factory = undefined
    await factory?.close()
    this.reason = 'The browser starts automatically when you open a tab.'
    this.changed()
  }
  async disable(): Promise<void> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(join(this.root, 'enabled'), '0', { mode: 0o600 })
    this.enabled = false
    await this.close()
  }
}
