import { randomUUID } from 'node:crypto'
import {
  admitAgentAction,
  humanInputReady,
  controllerDisconnected,
  giveToAgent,
  initialLease,
  observed,
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
  BrowserDiagnostics,
  BrowserDialog,
  BrowserPageSnapshot,
} from '@ramu/shared/browserBridge'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { TEMPORARY_PROFILE_ID, resolveProfile, validProfileId } from '@ramu/shared/browser'

// The integrated browser's tab manager. It owns tab identity, which profile each tab uses, navigation rules, limits and
// ownership; the actual web contents come from a factory, so this logic is testable without Electron and Electron
// stays at the edge. Tabs belong to (host, thread, run); user-opened tabs start with human control.

/** One guest page. Implemented over Electron web contents in main; faked in tests. */
export interface GuestPage {
  load(url: string): Promise<void>
  url(): string
  title(): string
  back(): void
  forward(): void
  reload(): void
  /** Reads the page for the agent: visible text and numbered interactive elements. Internal scripts only. */
  inspect(): Promise<PageSnapshot>
  /** Clicks or types into an element of the last inspection. `ok: false` says why the page refused. */
  act(action: PageAction): Promise<{ ok: boolean; reason?: string }>
  /** Native input is blocked until the controlling human can safely drive the page. */
  setHumanInput(enabled: boolean): void
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
}

export class BrowserRuntime {
  private readonly tabs = new Map<string, Tab>()
  private closed = false
  private readonly temporaryPartitions = new Map<string, string>()
  private cleanupWarning: string | undefined
  warning(): string | undefined {
    return this.cleanupWarning
  }
  private readonly lockedProfiles = new Set<string>()
  constructor(
    private readonly factory: GuestFactory,
    private readonly knownProfiles: () => readonly string[],
    private readonly changed: () => void = () => {},
    private readonly profileAvailable: (id: string) => boolean = () => true,
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

  private info(tab: Tab): TabInfo {
    const controller = tab.lease.controller
    return {
      id: tab.id,
      hostId: tab.owner.hostId,
      threadId: tab.owner.threadId,
      runId: tab.owner.runId ?? null,
      profileId: tab.profileId,
      url: tab.page.url(),
      title: tab.page.title(),
      controller: controller.kind === 'human' ? 'human' : controller.kind === 'agent' ? 'agent' : 'none',
      generation: tab.lease.generation,
      crashed: tab.crashed,
      inputReady: humanInputReady(tab.lease) && !tab.replacing && !tab.respondingDialog,
      paused: tab.lease.paused,
    }
  }

  list(owner?: Pick<BrowserOwner, 'hostId' | 'threadId'>): TabInfo[] {
    return [...this.tabs.values()]
      .filter((tab) => !owner || (tab.owner.hostId === owner.hostId && tab.owner.threadId === owner.threadId))
      .map((tab) => this.info(tab))
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
          ? takeControl(lease, initialController.deviceId, { local: true })
          : owner.runId
            ? giveToAgent(lease, 'local', owner.runId)
            : takeControl(lease, 'local', { local: true })
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
      if (from.lease.controller.kind === 'human')
        this.takeControl(opened.tab.id, from.lease.controller.deviceId, { local: true })
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

  private invalidate(tab: Tab) {
    tab.snapshot += 1
    tab.lease = { ...tab.lease, observed: false }
  }

  private syncInput(tab: Tab) {
    tab.page.setHumanInput(!tab.crashed && !tab.replacing && !tab.respondingDialog && humanInputReady(tab.lease))
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
    const tab = this.tab(id)
    this.requireHuman(tab)
    this.invalidate(tab)
    tab.page.back()
  }
  forward(id: string) {
    const tab = this.tab(id)
    this.requireHuman(tab)
    this.invalidate(tab)
    tab.page.forward()
  }
  reload(id: string) {
    const tab = this.tab(id)
    this.requireHuman(tab)
    this.invalidate(tab)
    tab.crashed = false
    tab.page.reload()
    this.syncInput(tab)
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
    tab.page.destroy()
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
    tab.lease = result.state
    tab.owner = { ...tab.owner, runId }
    this.invalidate(tab)
    this.syncInput(tab)
    this.changed()
    return this.info(tab)
  }

  takeControl(id: string, deviceId: string, options: { local?: boolean } = {}): TabInfo {
    const tab = this.tab(id)
    const result = takeControl(tab.lease, deviceId, options)
    if (!result.ok) throw new BrowserError(result.refused, 'Another device controls this tab. Ask it to hand over.')
    tab.lease = result.state
    this.invalidate(tab)
    this.syncInput(tab)
    this.changed()
    return this.info(tab)
  }

  controllerDisconnected(deviceId: string): void {
    for (const tab of this.tabs.values()) {
      tab.lease = controllerDisconnected(tab.lease, deviceId)
      this.invalidate(tab)
      this.syncInput(tab)
    }
    this.changed()
  }

  pauseForDisconnect() {
    for (const tab of this.tabs.values()) {
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
    if (tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining)
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
    if (tab.crashed || tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining)
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

  diagnosticsForAgent(id: string, owner: Pick<BrowserOwner, 'hostId' | 'threadId'>): BrowserDiagnostics {
    const tab = this.tab(id)
    this.assertOwner(tab, owner)
    if (!tab.page.diagnostics) throw new BrowserError('unavailable', 'Browser diagnostics are unavailable.')
    return tab.page.diagnostics()
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

  async handleDialogAsHuman(id: string, dialogId: string, accept: boolean, text?: string): Promise<void> {
    const tab = this.tab(id)
    if (tab.lease.controller.kind !== 'human' || tab.lease.controller.deviceId !== 'local' || tab.lease.paused)
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
    text: string,
    timeoutMs: number,
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
      const matched = snapshot.text.includes(text)
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
    return this.agentAction(id, runId, tab.lease.generation, owner, async (page) => {
      this.invalidate(tab)
      await page.load(url.toString())
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
    if (tab.replacing || tab.observing || tab.lease.inFlight || tab.lease.draining)
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
  endRun(owner: Required<BrowserOwner>): void {
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

  closeAll(): void {
    this.closed = true
    for (const tab of [...this.tabs.values()]) this.destroy(tab)
  }
}
