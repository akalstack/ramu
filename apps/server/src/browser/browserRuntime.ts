import { randomUUID } from 'node:crypto'
import {
  admitAgentAction,
  humanInputReady,
  controllerDisconnected,
  giveToAgent,
  initialLease,
  observed,
  admitHumanInput,
  revokeAgent,
  settleAgentAction,
  takeControl,
  type Controller,
  type LeaseRefusal,
  type LeaseState,
} from '@ramu/shared/control/lease'
import type {
  BrowserPageAction,
  BrowserScreenshot,
  BrowserLiveFrame,
  BrowserDiagnostics,
  BrowserDialog,
  BrowserFieldFocus,
  BrowserTabAdjust,
  BrowserPageSnapshot,
  BrowserHumanInput,
} from '@ramu/shared/browserBridge'
import type { BrowserTabInfo, BrowserViewport } from '@ramu/shared/types/browser'
import { BrowserUploads } from './browserUploads'
import { BrowserDownloads, type GuestDownload } from './browserDownloads'
import { TEMPORARY_PROFILE_ID, resolveProfile, validProfileId } from '@ramu/shared/browser'

// The integrated browser's tab manager. It owns tab identity, which profile each tab uses, navigation rules, limits and
// ownership; the actual web contents come from a factory, so this logic is testable without Electron and Electron
// stays at the edge. Tabs belong to (host, thread, run); user-opened tabs start with human control.

/** One guest page. Implemented over Electron web contents in main; faked in tests. */
export interface GuestPage {
  load(url: string): Promise<void>
  url(): string
  title(): string
  favicon?(): string | null
  back(): void | Promise<void>
  forward(): void | Promise<void>
  reload(): void | Promise<void>
  /** Reads the page for the agent: visible text and numbered interactive elements. Internal scripts only. */
  inspect(): Promise<PageSnapshot>
  /**
   * Lays the page out at a viewer's screen size while that viewer controls it; `null` restores the default viewport.
   * Absent where the page is also shown on a desktop, whose layout must not change under the person at the computer.
   */
  fit?(size: { width: number; height: number } | null): Promise<void>
  /** Lays the page out at a size the agent chose; `null` restores whatever layout the page had before. */
  emulate?(viewport: BrowserViewport | null): Promise<void>
  /** The kind of field that has focus, so the controlling phone can raise its keyboard. */
  focusedField?(): Promise<BrowserFieldFocus>
  /** Zoom, appearance, a hard reload or clearing the cache, as the controlling person asks. */
  adjust?(change: BrowserTabAdjust): Promise<void>
  /** Clicks or types into an element of the last inspection. `ok: false` says why the page refused. */
  act(action: PageAction): Promise<{ ok: boolean; reason?: string; points?: { x: number; y: number }[] }>
  /** Native input is blocked until the controlling human can safely drive the page. */
  /**
   * Whether a person may drive the page now, and whether that person is at this computer: a native page then also
   * takes its own mouse and keyboard, which must stay blocked while another of their devices has control.
   */
  setHumanInput(enabled: boolean, local?: boolean): void
  input?(input: BrowserHumanInput): Promise<void>
  nextFrame?(after: number): Promise<BrowserLiveFrame | null>
  screenshot?(): Promise<BrowserScreenshot>
  diagnostics?(): BrowserDiagnostics
  dialog?(): BrowserDialog | null
  handleDialog?(id: string, accept: boolean, text?: string): Promise<void>
  /** Places the page over this window rectangle (window coordinates); `hide` takes it off screen without closing it. */
  show(bounds: { x: number; y: number; width: number; height: number }): void
  hide(): void
  destroy(): void
}

export type PageSnapshot = Omit<BrowserPageSnapshot, 'tab' | 'snapshot'>

export type PageAction = BrowserPageAction

export interface GuestHandlers {
  onDownload?(download: GuestDownload): boolean
  /** The page tried to navigate (link, redirect or script); return false to stop it. */
  onNavigate(url: string): boolean
  /** The page asked for a new window. */
  onOpenWindow(url: string): void
  onCrash(): void
  /** Navigation/title changes invalidate references and refresh the pane. */
  onChanged?(): void
}

export interface GuestFactory {
  create(partition: string, handlers: GuestHandlers): GuestPage
  /** Drops an in-memory partition's data once its tabs are gone. */
  clearTemporary(partition: string): void | Promise<void>
}

export interface BrowserOwner {
  hostId: string
  threadId: string
  /** Absent for tabs the person opened without an agent run. */
  runId?: string
}

export type TabInfo = BrowserTabInfo

export const MAX_TABS_PER_THREAD = 8
export const MAX_TABS_TOTAL = 24
/** An agent-owned tab nobody has used for this long is closed, so forgotten pages do not hold memory for ever. */
export const IDLE_TAB_MS = 30 * 60_000

/** Websites are http(s) only. App, file and other schemes never load in a guest, and credentials in URLs are refused. */
export function allowedGuestUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export class BrowserError extends Error {
  constructor(
    readonly code:
      | 'bad-url'
      | 'too-many-tabs'
      | 'unknown-tab'
      | 'wrong-owner'
      | 'closed'
      | 'stale-snapshot'
      | 'busy'
      | 'crashed'
      | 'unavailable'
      | LeaseRefusal,
    message: string,
  ) {
    super(message)
  }
}

const RELEASED_RUN = 'released-for-next-run'

/** The device id of the person at the computer running a native page (the desktop app's own window). */
export const LOCAL_DEVICE = 'local'

interface Tab {
  id: string
  owner: BrowserOwner
  profileId: string
  partition: string
  page: GuestPage
  lease: LeaseState
  crashed: boolean
  /** Identifies the last inspection; element references from an older one are refused. */
  snapshot: number
  observing: boolean
  replacing: boolean
  respondingDialog: boolean
  /** The controlling person's own input still running. It never makes the tab look busy to that person. */
  humanInput: Promise<unknown>
  humanPending: number
  released?: boolean
  /** The controlling device asked for its screen size; dropped as soon as that device stops controlling the tab. */
  fit?: { deviceId: string; width: number; height: number }
  zoom?: number
  colorScheme?: 'light' | 'dark'
  /** The agent's chosen layout size; dropped as soon as a person takes control, who gets the page as they left it. */
  viewport?: BrowserViewport
  /** When anyone last used or changed this tab; the idle sweep closes an unused agent-owned tab. */
  lastActive: number
}

export class BrowserRuntime {
  private readonly uploads = new BrowserUploads()
  private readonly tabs = new Map<string, Tab>()
  private closed = false
  private readonly temporaryPartitions = new Map<string, string>()
  private cleanupWarning: string | undefined
  warning(): string | undefined {
    return this.cleanupWarning ?? this.downloads?.warning()
  }
  private readonly lockedProfiles = new Set<string>()
  constructor(
    private readonly factory: GuestFactory,
    private readonly knownProfiles: () => readonly string[],
    private readonly changed: () => void = () => {},
    private readonly profileAvailable: (id: string) => boolean = () => true,
    private readonly downloads?: BrowserDownloads,
    private readonly now: () => number = Date.now,
  ) {}

  /** Persistent profiles share one partition; Temporary is private to one run (or thread when no run exists). */
  private partitionFor(owner: BrowserOwner, profileId: string): string {
    if (profileId !== TEMPORARY_PROFILE_ID) return `persist:ramu-browser:${profileId}`
    const key = JSON.stringify([owner.hostId, owner.threadId, owner.runId ?? 'user'])
    let partition = this.temporaryPartitions.get(key)
    if (!partition) {
      partition = `ramu-browser-temp:${randomUUID()}`
      this.temporaryPartitions.set(key, partition)
    }
    return partition
  }

  /** `viewer` is the device asking; the answer then says whether that device is the one in control. */
  private info(tab: Tab, viewer?: string): TabInfo {
    const controller = tab.lease.controller
    const favicon = tab.page.favicon?.()
    return {
      id: tab.id,
      hostId: tab.owner.hostId,
      threadId: tab.owner.threadId,
      runId: tab.owner.runId ?? null,
      profileId: tab.profileId,
      ...(favicon ? { faviconUrl: favicon } : {}),
      url: tab.page.url(),
      title: tab.page.title(),
      controller: controller.kind === 'human' ? 'human' : controller.kind === 'agent' ? 'agent' : 'none',
      generation: tab.lease.generation,
      crashed: tab.crashed,
      inputReady: humanInputReady(tab.lease) && !tab.replacing && !tab.respondingDialog,
      paused: tab.lease.paused,
      ...(tab.released ? { released: true } : {}),
      ...(tab.fit ? { fitted: true } : {}),
      ...(tab.viewport ? { viewport: tab.viewport } : {}),
      ...(tab.zoom && tab.zoom !== 1 ? { zoom: tab.zoom } : {}),
      ...(tab.colorScheme ? { colorScheme: tab.colorScheme } : {}),
      ...(viewer !== undefined
        ? { controlledHere: controller.kind === 'human' && controller.deviceId === viewer && !tab.lease.paused }
        : {}),
    }
  }

  list(owner?: Pick<BrowserOwner, 'hostId' | 'threadId'>, viewer?: string): TabInfo[] {
    return [...this.tabs.values()]
      .filter((tab) => !owner || (tab.owner.hostId === owner.hostId && tab.owner.threadId === owner.threadId))
      .map((tab) => this.info(tab, viewer))
  }

  /**
   * Opens a tab for this owner. A profile that is gone falls back to Default (and the caller is told); a user-opened
   * tab starts human-controlled, an agent-run tab starts with nobody until the person releases it.
   */
  async open(
    owner: BrowserOwner,
    url: string,
    selectedProfile?: string,
    initialController?: Controller,
    replacingId?: string,
  ): Promise<{ tab: TabInfo; profileFellBack: boolean }> {
    if (this.closed) throw new BrowserError('closed', 'The browser is shutting down.')
    const target = allowedGuestUrl(url)
    if (!target) throw new BrowserError('bad-url', 'Only http and https pages can be opened.')
    const replacement = replacingId ? this.tabs.get(replacingId) : null
    const replacing =
      replacement && replacement.owner.hostId === owner.hostId && replacement.owner.threadId === owner.threadId ? 1 : 0
    const inThread = this.list(owner).length - replacing
    if (inThread >= MAX_TABS_PER_THREAD || this.tabs.size - replacing >= MAX_TABS_TOTAL)
      throw new BrowserError('too-many-tabs', 'Close a tab before opening another.')
    const { id: profileId, fellBack } = resolveProfile(selectedProfile, this.knownProfiles())
    if (!this.profileAvailable(profileId) || this.lockedProfiles.has(profileId))
      throw new BrowserError('busy', 'This profile is being cleared. Wait for it to finish.')
    const partition = this.partitionFor(owner, profileId)
    const id = randomUUID()
    const page = this.factory.create(partition, {
      onDownload: (item) => {
        const tab = this.tabs.get(id)
        if (!tab || tab.lease.paused || tab.lease.draining) return false
        const controller = tab.lease.controller
        if (controller.kind === 'none') return false
        return (
          this.downloads?.accept(
            {
              ...tab.owner,
              tabId: id,
              runId: controller.kind === 'agent' ? controller.runId : 'human',
              generation: tab.lease.generation,
            },
            item,
          ) ?? false
        )
      },
      onNavigate: (next) => {
        if (!allowedGuestUrl(next)) return false
        const current = this.tabs.get(id)
        if (current) this.invalidate(current)
        return true
      },
      onOpenWindow: (next) => void this.popup(id, next),
      onChanged: () => {
        const current = this.tabs.get(id)
        if (current) {
          this.invalidate(current)
          this.changed()
        }
      },
      onCrash: () => {
        const tab = this.tabs.get(id)
        if (tab) {
          this.downloads?.revoke(id)
          tab.crashed = true
          this.invalidate(tab)
          tab.page.setHumanInput(false)
          this.changed()
        }
      },
    })
    let lease = initialLease()
    // A person opening a page controls it; a tab an agent opened for its own run belongs to that run, until the
    // person takes it. Either way the agent must inspect the page before it acts.
    const first =
      initialController?.kind === 'none'
        ? null
        : initialController?.kind === 'human'
          ? takeControl(lease, initialController.deviceId)
          : owner.runId
            ? giveToAgent(lease, LOCAL_DEVICE, owner.runId)
            : takeControl(lease, LOCAL_DEVICE)
    if (first?.ok) lease = first.state
    const tab: Tab = {
      id,
      owner,
      profileId,
      partition,
      page,
      lease,
      crashed: false,
      snapshot: 0,
      observing: false,
      replacing: false,
      respondingDialog: false,
      humanInput: Promise.resolve(),
      humanPending: 0,
      lastActive: this.now(),
    }
    this.tabs.set(id, tab)
    this.syncInput(tab)
    let loadTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        page.load(target.toString()),
        new Promise<never>((_resolve, reject) => {
          loadTimer = setTimeout(
            () =>
              reject(
                new Error(
                  'The new browser page did not finish loading. Its tab was closed; inspect the website before trying again.',
                ),
              ),
            15000,
          )
        }),
      ])
    } catch (error) {
      if (this.tabs.get(id) === tab) this.destroy(tab)
      throw error
    } finally {
      clearTimeout(loadTimer)
    }
    if (this.tabs.get(id) !== tab) throw new BrowserError('closed', 'That tab is closed.')
    this.changed()
    return { tab: this.info(tab), profileFellBack: fellBack }
  }

  /** A page's window.open becomes a tab in the same thread and profile, when it is an allowed address and fits. */
  private async popup(fromId: string, url: string): Promise<void> {
    const from = this.tabs.get(fromId)
    if (!from || !allowedGuestUrl(url)) return
    try {
      const opened = await this.open(from.owner, url, from.profileId, from.lease.controller)
      // A popup follows the person's takeover, rather than silently handing its new page back to the agent.
      if (from.lease.controller.kind === 'human') this.takeControl(opened.tab.id, from.lease.controller.deviceId)
      else if (from.lease.controller.kind === 'none') {
        const popup = this.tab(opened.tab.id)
        if (popup.lease.controller.kind === 'agent')
          popup.lease = revokeAgent(popup.lease, popup.lease.controller.runId)
        this.syncInput(popup)
        this.changed()
      }
    } catch {
      // Over the limit or shutting down: the popup is simply dropped.
    }
  }

  private tab(id: string): Tab {
    const tab = this.tabs.get(id)
    if (!tab) throw new BrowserError('unknown-tab', 'That tab is closed.')
    tab.lastActive = this.now()
    return tab
  }

  /** Human navigation and controls: only while the person controls the tab. */
  async navigate(id: string, url: string): Promise<TabInfo> {
    const tab = this.tab(id)
    const target = allowedGuestUrl(url)
    if (!target) throw new BrowserError('bad-url', 'Only http and https pages can be opened.')
    this.requireHuman(tab)
    this.invalidate(tab)
    await tab.page.load(target.toString())
    tab.crashed = false
    this.changed()
    return this.info(tab)
  }

  private requireHuman(tab: Tab) {
    if (tab.replacing || tab.respondingDialog || !humanInputReady(tab.lease))
      throw new BrowserError(
        'not-controller',
        'Take control and wait for the agent action to finish before navigating.',
      )
  }
  requireHumanDevice(id: string, deviceId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): void {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (tab.lease.controller.kind !== 'human' || tab.lease.controller.deviceId !== deviceId || tab.lease.paused)
      throw new BrowserError('not-controller', 'Take control before changing this page.')
  }

  private invalidate(tab: Tab) {
    tab.lastActive = this.now()
    tab.snapshot += 1
    tab.lease = { ...tab.lease, observed: false }
  }

  private syncInput(tab: Tab) {
    const ready = !tab.crashed && !tab.replacing && !tab.respondingDialog && humanInputReady(tab.lease)
    const controller = tab.lease.controller
    tab.page.setHumanInput(ready, ready && controller.kind === 'human' && controller.deviceId === LOCAL_DEVICE)
    // The agent and other devices always get the default layout back once the fitted device stops controlling.
    if (
      tab.fit &&
      (controller.kind !== 'human' || controller.deviceId !== tab.fit.deviceId || tab.lease.paused || tab.crashed)
    ) {
      tab.fit = undefined
      void tab.page.fit?.(null).catch(() => {})
    }
    if (tab.viewport && controller.kind === 'human') {
      tab.viewport = undefined
      void tab.page.emulate?.(null).catch(() => {})
    }
  }

  /** The controlling device changes how the page is shown; zoom and appearance stay with the tab for everyone. */
  async adjustAsHuman(
    id: string,
    deviceId: string,
    change: BrowserTabAdjust,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<TabInfo> {
    this.requireHumanDevice(id, deviceId, owner)
    const tab = this.tab(id)
    if (!tab.page.adjust)
      throw new BrowserError('unavailable', 'Update Ramu on this computer to change the page display.')
    await tab.page.adjust(change)
    if (change.zoom !== undefined) tab.zoom = change.zoom
    if (change.colorScheme) tab.colorScheme = change.colorScheme === 'system' ? undefined : change.colorScheme
    this.changed()
    return this.info(tab)
  }

  /** Only the controlling device learns whether a field has focus; the answer never includes the field's value. */
  async focusedFieldForHuman(
    id: string,
    deviceId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<BrowserFieldFocus> {
    this.requireHumanDevice(id, deviceId, owner)
    const tab = this.tab(id)
    if (!tab.page.focusedField || tab.crashed) return { editable: false }
    return tab.page.focusedField().catch(() => ({ editable: false }))
  }

  /** The controlling device lays the page out for its screen, as a phone browser would; `null` restores it. */
  async fitToViewer(
    id: string,
    deviceId: string,
    size: { width: number; height: number } | null,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<{ fitted: boolean }> {
    this.requireHumanDevice(id, deviceId, owner)
    const tab = this.tab(id)
    if (!tab.page.fit) return { fitted: false }
    if (size && tab.fit?.width === size.width && tab.fit.height === size.height) return { fitted: true }
    await tab.page.fit(size)
    // Control may have changed while the page resized; never leave a stale layout behind.
    const controller = tab.lease.controller
    if (controller.kind !== 'human' || controller.deviceId !== deviceId || tab.lease.paused) {
      tab.fit = undefined
      await tab.page.fit(null).catch(() => {})
      return { fitted: false }
    }
    tab.fit = size ? { deviceId, ...size } : undefined
    this.changed()
    return { fitted: !!size }
  }

  async changeProfile(id: string, profileId: string): Promise<TabInfo> {
    const tab = this.tab(id)
    this.requireHuman(tab)
    const target = resolveProfile(profileId, this.knownProfiles())
    if (target.fellBack) throw new Error('That browser profile is no longer available. Choose another profile.')
    if (target.id === tab.profileId) return this.info(tab)
    const generation = tab.lease.generation,
      revision = tab.snapshot
    tab.replacing = true
    this.syncInput(tab)
    this.changed()
    let replacementId: string | undefined
    try {
      const opened = await this.open(
        { hostId: tab.owner.hostId, threadId: tab.owner.threadId },
        tab.page.url(),
        target.id,
        tab.lease.controller,
        id,
      )
      replacementId = opened.tab.id
      if (this.tabs.get(id) !== tab || tab.lease.generation !== generation || tab.snapshot !== revision)
        throw new BrowserError('stale-snapshot', 'The original page changed. Review the profile change again.')
      this.destroy(tab)
      this.changed()
      return opened.tab
    } catch (error) {
      if (replacementId && this.tabs.has(replacementId)) this.destroy(this.tab(replacementId))
      throw error
    } finally {
      if (this.tabs.get(id) === tab) {
        tab.replacing = false
        this.syncInput(tab)
        this.changed()
      }
    }
  }

  back(id: string) {
    return this.historyAsHuman(id, 'back')
  }
  forward(id: string) {
    return this.historyAsHuman(id, 'forward')
  }
  reload(id: string) {
    return this.historyAsHuman(id, 'reload')
  }
  private async historyAsHuman(id: string, direction: 'back' | 'forward' | 'reload') {
    const tab = this.tab(id)
    this.requireHuman(tab)
    this.invalidate(tab)
    if (direction === 'reload') tab.crashed = false
    tab.replacing = true
    this.syncInput(tab)
    try {
      await tab.page[direction]()
    } finally {
      if (this.tabs.get(id) === tab) {
        tab.replacing = false
        this.invalidate(tab)
        this.syncInput(tab)
        this.changed()
      }
    }
  }

  /** Shows a tab where the pane is; the renderer reports the pane's rectangle. */
  show(id: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.tab(id).page.show(bounds)
  }

  hide(id: string): void {
    this.tab(id).page.hide()
  }

  close(id: string): void {
    this.destroy(this.tab(id))
    this.changed()
  }

  private destroy(tab: Tab) {
    this.downloads?.revoke(tab.id)
    this.uploads.closeTab(tab.id)
    try {
      tab.page.destroy()
    } catch {
      // A page that is already gone must not leave its tab registered or its temporary data behind.
    }
    this.tabs.delete(tab.id)
    const last = ![...this.tabs.values()].some((other) => other.partition === tab.partition)
    if (last && tab.profileId === TEMPORARY_PROFILE_ID) {
      for (const [key, partition] of this.temporaryPartitions)
        if (partition === tab.partition) this.temporaryPartitions.delete(key)
      const failed = () => {
        this.cleanupWarning =
          'Temporary browser data cleanup failed. Its closed context will not be reused; restart Ramu to release it.'
        this.changed()
      }
      try {
        void Promise.resolve(this.factory.clearTemporary(tab.partition)).catch(failed)
      } catch {
        failed()
      }
    }
  }

  // ---- Ownership ----

  /** The person releases a tab to an agent run in its thread; a fresh observation is required before it acts. */
  giveToAgent(id: string, deviceId: string, runId: string): TabInfo {
    const tab = this.tab(id)
    const result = giveToAgent(tab.lease, deviceId, runId)
    if (!result.ok) throw new BrowserError(result.refused, 'This tab is controlled by another device.')
    this.downloads?.revoke(id)
    tab.lease = result.state
    tab.released = false
    tab.owner = { ...tab.owner, runId }
    this.invalidate(tab)
    this.syncInput(tab)
    this.changed()
    return this.info(tab)
  }

  /**
   * The person hands a tab back while no agent run is active. Nobody drives it meanwhile; the thread's next run takes
   * it over at its first browser command, so the release is not lost when the agent is not running yet.
   */
  releaseForNextRun(id: string, deviceId: string): TabInfo {
    const tab = this.tab(id)
    const handed = giveToAgent(tab.lease, deviceId, RELEASED_RUN)
    if (!handed.ok) throw new BrowserError(handed.refused, 'This tab is controlled by another device.')
    this.downloads?.revoke(id)
    tab.lease = revokeAgent(handed.state, RELEASED_RUN)
    tab.released = true
    this.invalidate(tab)
    this.syncInput(tab)
    this.changed()
    return this.info(tab)
  }

  /** A run's first command on a tab the person released for it makes the run its controller. */
  adoptReleased(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): void {
    const tab = this.tabs.get(id)
    // Nobody holds the tab (an earlier run ended, or the person handed it back), so this thread's run may take it.
    // A tab the person is controlling, or whose controller disconnected, is never taken.
    if (!tab || tab.lease.controller.kind !== 'none' || tab.lease.paused) return
    this.assertOwner(tab, owner)
    this.giveToAgent(id, LOCAL_DEVICE, runId)
  }

  takeControl(id: string, deviceId: string): TabInfo {
    const tab = this.tab(id)
    const result = takeControl(tab.lease, deviceId)
    if (!result.ok) throw new BrowserError(result.refused, 'Another device controls this tab. Ask it to hand over.')
    this.downloads?.revoke(id)
    tab.lease = result.state
    tab.released = false
    this.invalidate(tab)
    this.syncInput(tab)
    this.changed()
    return this.info(tab, deviceId)
  }

  controllerDisconnected(deviceId: string): void {
    for (const tab of this.tabs.values()) {
      this.downloads?.revoke(tab.id)
      tab.lease = controllerDisconnected(tab.lease, deviceId)
      this.invalidate(tab)
      this.syncInput(tab)
    }
    this.changed()
  }

  pauseForDisconnect() {
    for (const tab of this.tabs.values()) {
      this.downloads?.revoke(tab.id)
      if (tab.lease.controller.kind === 'agent') tab.lease = revokeAgent(tab.lease, tab.lease.controller.runId)
      else if (tab.lease.controller.kind === 'human')
        tab.lease = controllerDisconnected(tab.lease, tab.lease.controller.deviceId)
      this.invalidate(tab)
      this.syncInput(tab)
    }
    this.changed()
  }

  /** The agent looked at the page; this satisfies the observe-after-release rule. */
  observeForAgent(id: string, runId: string): TabInfo {
    const tab = this.tab(id)
    tab.lease = observed(tab.lease, runId)
    return this.info(tab)
  }

  /**
   * Reads the page for an agent run. Allowed while the person controls the tab too (visibility is a separate grant
   * from control), and it starts a new snapshot: element references from an earlier one stop working.
   */
  async inspectForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<PageSnapshot & { tab: TabInfo; snapshot: number }> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (tab.crashed) throw new BrowserError('crashed', 'This page stopped working. Reload it.')
    if (tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining || tab.humanPending)
      throw new BrowserError('busy', 'Wait for the current browser operation to finish, then inspect again.')
    const generation = tab.lease.generation
    const revision = tab.snapshot
    tab.observing = true
    try {
      const page = await tab.page.inspect()
      if (this.tabs.get(id) !== tab) throw new BrowserError('closed', 'That tab is closed.')
      if (tab.lease.generation !== generation || tab.snapshot !== revision)
        throw new BrowserError('stale-snapshot', 'The page or its controller changed. Take a new snapshot first.')
      tab.snapshot += 1
      tab.lease = observed(tab.lease, runId)
      return { ...page, snapshot: tab.snapshot, tab: this.info(tab) }
    } finally {
      tab.observing = false
    }
  }

  /** Runs a click or typing action against the latest snapshot, under the lease rules. */
  private uploadOwner(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>) {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (tab.lease.controller.kind !== 'agent' || tab.lease.controller.runId !== runId || tab.lease.paused)
      throw new BrowserError('human-controlled', 'Upload requires control of this browser tab.')
    return { ...owner, runId, tabId: id, generation: tab.lease.generation }
  }
  private downloadStore(): BrowserDownloads {
    if (!this.downloads) throw new BrowserError('unavailable', 'Downloads are unavailable on this browser runtime.')
    return this.downloads
  }
  prepareDownload(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>) {
    this.downloadStore().prepare(this.uploadOwner(id, runId, owner))
    return { expiresInSeconds: 60, maximumBytes: 32 * 1024 * 1024 }
  }
  prepareHumanDownload(id: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): void {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (tab.lease.controller.kind !== 'human' || tab.lease.paused || tab.lease.draining)
      throw new Error('Take control before allowing a download.')
    this.downloadStore().prepare({ ...owner, runId: 'human', tabId: id, generation: tab.lease.generation })
  }
  listDownloads(owner: Pick<BrowserOwner, 'hostId' | 'threadId'>, tabId?: string) {
    return this.downloadStore().list(owner.hostId, owner.threadId, tabId)
  }
  readDownload(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    downloadId: string,
    offset: number,
  ) {
    return this.downloadStore().read(downloadId, this.uploadOwner(id, runId, owner), offset)
  }
  cancelDownload(downloadId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): void {
    this.downloadStore().cancel(downloadId, owner.hostId, owner.threadId)
  }
  saveDownload(downloadId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>, path: string): void {
    this.downloadStore().save(downloadId, owner.hostId, owner.threadId, path)
  }
  readDownloadAsHuman(downloadId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>, offset: number) {
    return this.downloadStore().readOwned(downloadId, owner.hostId, owner.threadId, offset)
  }
  beginUpload(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>, name: string, size: number) {
    return { uploadId: this.uploads.begin(this.uploadOwner(id, runId, owner), name, size) }
  }
  uploadChunk(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    uploadId: string,
    offset: number,
    data: string,
  ) {
    return { received: this.uploads.chunk(uploadId, this.uploadOwner(id, runId, owner), offset, data) }
  }
  cancelUpload(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>, uploadId: string) {
    // Cancellation can release staged bytes after human takeover too; it never changes the page or its control.
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    this.uploads.cancel(uploadId, { ...owner, runId, tabId: id, generation: tab.lease.generation })
    return null
  }
  async uploadForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    uploadId: string,
    snapshot: number,
    ref: number,
  ) {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (snapshot !== tab.snapshot)
      throw new BrowserError('stale-snapshot', 'The page changed. Take a fresh snapshot before uploading.')
    return this.agentAction(id, runId, tab.lease.generation, owner, (page) => {
      const file = this.uploads.consume(uploadId, this.uploadOwner(id, runId, owner))
      this.invalidate(tab)
      return page.act({ kind: 'upload', snapshot, ref, ...file })
    })
  }

  async actForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    action: PageAction,
  ): Promise<{ ok: boolean; reason?: string }> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (action.snapshot !== tab.snapshot)
      throw new BrowserError('stale-snapshot', 'The page changed since it was read. Take a new snapshot first.')
    return this.agentAction(id, runId, tab.lease.generation, owner, (page) => {
      this.invalidate(tab)
      return page.act(action)
    })
  }

  async screenshotForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<BrowserScreenshot> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.screenshot)
      throw new BrowserError('unavailable', 'Screenshots are unavailable in this browser runtime.')
    if (tab.crashed || tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining || tab.humanPending)
      throw new BrowserError('busy', 'Wait for the current browser operation to finish.')
    const generation = tab.lease.generation,
      revision = tab.snapshot
    tab.observing = true
    try {
      const image = await tab.page.screenshot()
      if (this.tabs.get(id) !== tab || tab.lease.generation !== generation || tab.snapshot !== revision)
        throw new BrowserError('stale-snapshot', 'The page or its controller changed during capture. Capture again.')
      tab.lease = observed(tab.lease, runId)
      return image
    } finally {
      tab.observing = false
    }
  }

  /**
   * A picture for a person watching the tab from a live view. It reads only: no lease, snapshot or control changes,
   * and it waits rather than racing an agent's own capture.
   */
  async previewForViewer(
    id: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
  ): Promise<BrowserScreenshot | null> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.screenshot || tab.crashed || tab.replacing || tab.observing) return null
    return tab.page.screenshot()
  }

  diagnosticsForAgent(id: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): BrowserDiagnostics {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.diagnostics) throw new BrowserError('unavailable', 'Browser diagnostics are unavailable.')
    return tab.page.diagnostics()
  }
  async captureForViewer(id: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): Promise<BrowserScreenshot> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.screenshot || tab.crashed || tab.replacing)
      throw new BrowserError('busy', 'Wait for the browser page to finish its current operation.')
    const generation = tab.lease.generation
    const image = await tab.page.screenshot()
    if (this.tabs.get(id) !== tab || tab.lease.generation !== generation)
      throw new BrowserError('stale-generation', 'Browser control changed during capture.')
    return image
  }

  async nextFrameForViewer(
    id: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    after: number,
  ): Promise<BrowserLiveFrame | null> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.nextFrame)
      throw new BrowserError('unavailable', 'Live browser frames are unavailable. Update this host.')
    if (tab.crashed || tab.replacing)
      throw new BrowserError('busy', 'Wait for the browser page to finish its current operation.')
    const frame = await tab.page.nextFrame(after)
    if (this.tabs.get(id) !== tab) throw new BrowserError('closed', 'That browser tab is closed.')
    this.assertOwner(tab, owner)
    return frame
  }

  dialogForAgent(id: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): BrowserDialog | null {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    return tab.page.dialog?.() ?? null
  }

  async handleDialogForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    dialogId: string,
    accept: boolean,
    text?: string,
  ): Promise<void> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.handleDialog || tab.page.dialog?.()?.id !== dialogId)
      throw new BrowserError('stale-snapshot', 'That website dialog is no longer open. Inspect dialog status again.')
    if (tab.respondingDialog) throw new BrowserError('busy', 'This dialog is already being answered.')
    // The exact live dialog id is an observation. Its reply can unblock an earlier in-flight click.
    const generation = tab.lease.generation
    const admitted = admitAgentAction(observed(tab.lease, runId), runId, generation)
    if (!admitted.ok)
      throw new BrowserError(admitted.refused, 'Take control or return this tab to the active agent before answering.')
    tab.lease = admitted.state
    tab.respondingDialog = true
    this.syncInput(tab)
    try {
      await tab.page.handleDialog(dialogId, accept, text)
    } finally {
      if (this.tabs.get(id) === tab) {
        tab.respondingDialog = false
        tab.lease = settleAgentAction(tab.lease, generation)
        this.invalidate(tab)
        this.syncInput(tab)
        this.changed()
      }
    }
  }

  async handleDialogAsHuman(
    id: string,
    dialogId: string,
    accept: boolean,
    text?: string,
    deviceId = LOCAL_DEVICE,
  ): Promise<void> {
    const tab = this.tab(id)
    if (tab.lease.controller.kind !== 'human' || tab.lease.controller.deviceId !== deviceId || tab.lease.paused)
      throw new BrowserError('not-controller', 'Take control before answering the website dialog.')
    if (tab.respondingDialog) throw new BrowserError('busy', 'This dialog is already being answered.')
    if (!tab.page.handleDialog || tab.page.dialog?.()?.id !== dialogId)
      throw new BrowserError('stale-snapshot', 'That website dialog is no longer open.')
    tab.respondingDialog = true
    this.syncInput(tab)
    try {
      await tab.page.handleDialog(dialogId, accept, text)
    } finally {
      if (this.tabs.get(id) === tab) {
        tab.respondingDialog = false
        this.invalidate(tab)
        this.syncInput(tab)
        this.changed()
      }
    }
  }

  async waitForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    text: string | undefined,
    timeoutMs: number,
    urlIncludes?: string,
  ): Promise<BrowserPageSnapshot & { matched: boolean }> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    const generation = tab.lease.generation
    const deadline = Date.now() + Math.max(0, Math.min(10000, timeoutMs))
    for (;;) {
      if (
        this.tabs.get(id) !== tab ||
        tab.lease.generation !== generation ||
        tab.lease.controller.kind !== 'agent' ||
        tab.lease.controller.runId !== runId
      )
        throw new BrowserError('stale-generation', 'Browser control changed while waiting. Inspect the page again.')
      const snapshot = await this.inspectForAgent(id, runId, owner)
      const matched =
        (text === undefined || snapshot.text.includes(text)) &&
        (urlIncludes === undefined || snapshot.url.includes(urlIncludes))
      if (matched || Date.now() >= deadline) return { ...snapshot, matched }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))))
    }
  }

  async navigateForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    raw: string,
  ): Promise<TabInfo> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    const url = allowedGuestUrl(raw)
    if (!url) throw new BrowserError('bad-url', 'Only http and https pages can be opened.')
    // Going to an address needs no element reference, so the run need not have read the page first.
    tab.lease = observed(tab.lease, runId)
    return this.agentAction(id, runId, tab.lease.generation, owner, async (page) => {
      this.invalidate(tab)
      await page.load(url.toString())
      return this.info(tab)
    })
  }

  /** Back, forward or reload for the run that controls the tab, as the person would from the toolbar. */
  async historyForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    move: 'back' | 'forward' | 'reload',
  ): Promise<TabInfo> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    tab.lease = observed(tab.lease, runId)
    return this.agentAction(id, runId, tab.lease.generation, owner, async (page) => {
      this.invalidate(tab)
      await page[move]()
      return this.info(tab)
    })
  }

  /** Lays the page out at a phone, tablet or desktop size for the run that controls it; `null` restores it. */
  async resizeForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    viewport: BrowserViewport | null,
  ): Promise<TabInfo> {
    if (
      viewport &&
      ![viewport.width, viewport.height].every((side) => Number.isInteger(side) && side >= 200 && side <= 4000)
    )
      throw new Error('Use a width and height from 200 to 4000 pixels.')
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    tab.lease = observed(tab.lease, runId)
    return this.agentAction(id, runId, tab.lease.generation, owner, async (page) => {
      if (!page.emulate) throw new BrowserError('unavailable', 'Update Ramu on this computer to resize the page.')
      await page.emulate(viewport)
      this.invalidate(tab)
      tab.viewport = viewport ? { width: viewport.width, height: viewport.height, mobile: viewport.mobile } : undefined
      this.changed()
      return this.info(tab)
    })
  }

  /** Light or dark mode for the page, as the person's appearance switch sets it; it stays with the tab. */
  async appearanceForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    colorScheme: NonNullable<BrowserTabAdjust['colorScheme']>,
  ): Promise<TabInfo> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    tab.lease = observed(tab.lease, runId)
    return this.agentAction(id, runId, tab.lease.generation, owner, async (page) => {
      if (!page.adjust)
        throw new BrowserError('unavailable', 'Update Ramu on this computer to change the page display.')
      await page.adjust({ colorScheme })
      tab.colorScheme = colorScheme === 'system' ? undefined : colorScheme
      this.changed()
      return this.info(tab)
    })
  }

  async closeForAgent(id: string, runId: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): Promise<void> {
    const tab = this.tab(id)
    return this.agentAction(id, runId, tab.lease.generation, owner, async () => {
      this.close(id)
    })
  }

  private assertOwner(tab: Tab, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>) {
    // Identity comes from the server-derived owner, never from the caller's claim about the tab.
    if (tab.owner.hostId !== owner.hostId || tab.owner.threadId !== owner.threadId)
      throw new BrowserError('wrong-owner', 'That tab belongs to another thread.')
  }

  /**
   * Runs one agent mutation if the run holds a current lease. The action runs against the tab's page and settles the
   * lease whether it succeeds or throws, so a failed action never blocks a later takeover.
   */
  async agentAction<T>(
    id: string,
    runId: string,
    generation: number,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    action: (page: GuestPage) => Promise<T>,
  ): Promise<T> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (tab.crashed) throw new BrowserError('crashed', 'This page stopped working. Reload it.')
    const admitted = admitAgentAction(tab.lease, runId, generation)
    if (!admitted.ok)
      throw new BrowserError(admitted.refused, `The agent cannot act on this tab (${admitted.refused}).`)
    if (tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining || tab.humanPending)
      throw new BrowserError('busy', 'Wait for the current browser operation to finish and inspect again.')
    tab.lease = admitted.state
    this.syncInput(tab)
    try {
      return await action(tab.page)
    } finally {
      const live = this.tabs.get(id)
      if (live) {
        live.lease = settleAgentAction(live.lease, generation)
        this.syncInput(live)
        this.changed()
      }
    }
  }

  /** A run ended or was stopped: its leases are revoked, its temporary tabs close and user-opened tabs stay. */
  async inputAsHuman(
    id: string,
    deviceId: string,
    generation: number,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    input: BrowserHumanInput,
  ): Promise<void> {
    return this.humanAction(id, deviceId, generation, owner, async (page) => {
      if (!page.input) throw new BrowserError('unavailable', 'Remote input is unavailable.')
      await page.input(input)
    })
  }
  async uploadAsHuman(
    id: string,
    deviceId: string,
    generation: number,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    snapshot: number,
    ref: number,
    file: { name: string; data: string },
  ) {
    const tab = this.tab(id)
    if (snapshot !== tab.snapshot)
      throw new BrowserError('stale-snapshot', 'Read the page again before choosing an upload input.')
    return this.humanAction(id, deviceId, generation, owner, (page) =>
      page.act({ kind: 'upload', snapshot, ref, ...file }),
    )
  }
  private async humanAction<T>(
    id: string,
    deviceId: string,
    generation: number,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    work: (page: GuestPage) => Promise<T>,
  ): Promise<T> {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    const admit = () => {
      const admitted = admitHumanInput(tab.lease, deviceId, generation)
      if (!admitted.ok)
        throw new BrowserError(admitted.refused, 'Browser control changed. Refresh before sending input.')
      if (!humanInputReady(tab.lease) || tab.observing || tab.replacing || tab.crashed)
        throw new BrowserError('busy', 'Wait for the current browser action to finish.')
    }
    admit()
    // The person's input runs in order, after their previous input, and is not counted as agent work: the tab stays
    // ready for them while a click they made is still loading the next page.
    tab.humanPending++
    this.invalidate(tab)
    const run = tab.humanInput.then(() => {
      admit()
      return work(tab.page)
    })
    tab.humanInput = run.catch(() => {})
    try {
      return await run
    } finally {
      tab.humanPending--
      if (this.tabs.get(id) === tab) {
        this.syncInput(tab)
        this.changed()
      }
    }
  }

  endRun(owner: Required<BrowserOwner>): void {
    this.downloads?.endRun(owner.hostId, owner.threadId, owner.runId)
    this.uploads.endRun(owner.hostId, owner.threadId, owner.runId)
    for (const tab of [...this.tabs.values()]) {
      if (tab.owner.hostId !== owner.hostId || tab.owner.threadId !== owner.threadId) continue
      if (tab.owner.runId === owner.runId && tab.profileId === TEMPORARY_PROFILE_ID) this.destroy(tab)
      else {
        tab.lease = revokeAgent(tab.lease, owner.runId)
        this.invalidate(tab)
        this.syncInput(tab)
      }
    }
    this.changed()
  }

  /** Profile administration closes every affected tab before site data is removed, and blocks racing opens. */
  async withClosedProfile<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
    if (!validProfileId(profileId) || profileId === TEMPORARY_PROFILE_ID)
      throw new Error('Choose a persistent browser profile.')
    if (this.lockedProfiles.has(profileId)) throw new BrowserError('busy', 'This profile is already being changed.')
    this.lockedProfiles.add(profileId)
    try {
      for (const tab of [...this.tabs.values()]) if (tab.profileId === profileId) this.destroy(tab)
      this.changed()
      return await operation()
    } finally {
      this.lockedProfiles.delete(profileId)
    }
  }

  /**
   * Closes tabs the agent (or nobody) controls that have been idle for `idleMs`. A tab the person controls is never closed
   * for being idle, and profile data is untouched: only the page goes. Returns how many were closed.
   */
  sweepIdle(idleMs = IDLE_TAB_MS): number {
    const now = this.now()
    const idle = [...this.tabs.values()].filter(
      (tab) => tab.lease.controller.kind !== 'human' && !tab.lease.draining && now - tab.lastActive >= idleMs,
    )
    for (const tab of idle) this.destroy(tab)
    if (idle.length) this.changed()
    return idle.length
  }

  private idleTimer?: ReturnType<typeof setInterval>
  /** Runs `sweepIdle` every `everyMs` until `closeAll`. The timer never keeps the process alive. */
  startIdleSweep(everyMs = 60_000): void {
    if (this.idleTimer || this.closed) return
    this.idleTimer = setInterval(() => this.sweepIdle(), everyMs)
    this.idleTimer.unref?.()
  }

  closeAll(): void {
    clearInterval(this.idleTimer)
    this.downloads?.close()
    this.uploads.close()
    this.closed = true
    for (const tab of [...this.tabs.values()]) this.destroy(tab)
  }
}
