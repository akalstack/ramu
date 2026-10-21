import { randomUUID } from 'node:crypto'
import {
  admitAgentAction,
  controllerDisconnected,
  giveToAgent,
  initialLease,
  observed,
  revokeAgent,
  settleAgentAction,
  takeControl,
  type LeaseRefusal,
  type LeaseState,
} from '@ramu/shared/control/lease'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { TEMPORARY_PROFILE_ID, resolveProfile } from '@ramu/shared/browser'

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
  /** Places the page over this window rectangle (window coordinates); `hide` takes it off screen without closing it. */
  show(bounds: { x: number; y: number; width: number; height: number }): void
  hide(): void
  destroy(): void
}

export interface PageElement {
  ref: number
  tag: string
  role: string
  name: string
  type?: string
  href?: string
}

export interface PageSnapshot {
  url: string
  title: string
  text: string
  elements: PageElement[]
  /** True when text or the element list was cut to its limit. */
  truncated: boolean
}

export type PageAction =
  | { kind: 'click'; snapshot: number; ref: number }
  | { kind: 'type'; snapshot: number; ref: number; text: string; submit: boolean }

export interface GuestHandlers {
  /** The page tried to navigate (link, redirect or script); return false to stop it. */
  onNavigate(url: string): boolean
  /** The page asked for a new window. */
  onOpenWindow(url: string): void
  onCrash(): void
}

export interface GuestFactory {
  create(partition: string, handlers: GuestHandlers): GuestPage
  /** Drops an in-memory partition's data once its tabs are gone. */
  clearTemporary(partition: string): void
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
}

export class BrowserRuntime {
  private readonly tabs = new Map<string, Tab>()
  private closed = false
  constructor(
    private readonly factory: GuestFactory,
    private readonly knownProfiles: () => readonly string[],
    private readonly changed: () => void = () => {},
  ) {}

  /** Persistent profiles share one partition; Temporary is private to one run (or thread when no run exists). */
  private partitionFor(owner: BrowserOwner, profileId: string): string {
    return profileId === TEMPORARY_PROFILE_ID
      ? `ramu-browser-temp:${owner.hostId}:${owner.threadId}:${owner.runId ?? 'user'}`
      : `persist:ramu-browser:${profileId}`
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
  ): Promise<{ tab: TabInfo; profileFellBack: boolean }> {
    if (this.closed) throw new BrowserError('closed', 'The browser is shutting down.')
    const target = allowedGuestUrl(url)
    if (!target) throw new BrowserError('bad-url', 'Only http and https pages can be opened.')
    const inThread = this.list(owner).length
    if (inThread >= MAX_TABS_PER_THREAD || this.tabs.size >= MAX_TABS_TOTAL)
      throw new BrowserError('too-many-tabs', 'Close a tab before opening another.')
    const { id: profileId, fellBack } = resolveProfile(selectedProfile, this.knownProfiles())
    const partition = this.partitionFor(owner, profileId)
    const id = randomUUID()
    const page = this.factory.create(partition, {
      onNavigate: (next) => allowedGuestUrl(next) !== null,
      onOpenWindow: (next) => void this.popup(id, next),
      onCrash: () => {
        const tab = this.tabs.get(id)
        if (tab) {
          tab.crashed = true
          this.changed()
        }
      },
    })
    let lease = initialLease()
    // A person opening a page controls it; a tab an agent opened for its own run belongs to that run, until the
    // person takes it. Either way the agent must inspect the page before it acts.
    const first = owner.runId ? giveToAgent(lease, 'local', owner.runId) : takeControl(lease, 'local', { local: true })
    if (first.ok) lease = first.state
    const tab: Tab = { id, owner, profileId, partition, page, lease, crashed: false, snapshot: 0 }
    this.tabs.set(id, tab)
    try {
      await page.load(target.toString())
    } catch (error) {
      this.destroy(tab)
      throw error
    }
    this.changed()
    return { tab: this.info(tab), profileFellBack: fellBack }
  }

  /** A page's window.open becomes a tab in the same thread and profile, when it is an allowed address and fits. */
  private async popup(fromId: string, url: string): Promise<void> {
    const from = this.tabs.get(fromId)
    if (!from || !allowedGuestUrl(url)) return
    try {
      await this.open(from.owner, url, from.profileId)
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
    await tab.page.load(target.toString())
    this.changed()
    return this.info(tab)
  }

  back(id: string) {
    this.tab(id).page.back()
  }
  forward(id: string) {
    this.tab(id).page.forward()
  }
  reload(id: string) {
    this.tab(id).page.reload()
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
    if (last && tab.profileId === TEMPORARY_PROFILE_ID) this.factory.clearTemporary(tab.partition)
  }

  // ---- Ownership ----

  /** The person releases a tab to an agent run in its thread; a fresh observation is required before it acts. */
  giveToAgent(id: string, deviceId: string, runId: string): TabInfo {
    const tab = this.tab(id)
    const result = giveToAgent(tab.lease, deviceId, runId)
    if (!result.ok) throw new BrowserError(result.refused, 'This tab is controlled by another device.')
    tab.lease = result.state
    this.changed()
    return this.info(tab)
  }

  takeControl(id: string, deviceId: string, options: { local?: boolean } = {}): TabInfo {
    const tab = this.tab(id)
    const result = takeControl(tab.lease, deviceId, options)
    if (!result.ok) throw new BrowserError(result.refused, 'Another device controls this tab. Ask it to hand over.')
    tab.lease = result.state
    this.changed()
    return this.info(tab)
  }

  controllerDisconnected(deviceId: string): void {
    for (const tab of this.tabs.values()) tab.lease = controllerDisconnected(tab.lease, deviceId)
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
    const page = await tab.page.inspect()
    tab.snapshot += 1
    tab.lease = observed(tab.lease, runId)
    return { ...page, snapshot: tab.snapshot, tab: this.info(tab) }
  }

  /** Runs a click or typing action against the latest snapshot, under the lease rules. */
  async actForAgent(
    id: string,
    runId: string,
    owner: Pick<BrowserOwner, 'hostId' | 'threadId'>,
    action: PageAction,
  ): Promise<{ ok: boolean; reason?: string }> {
    const tab = this.tab(id)
    if (action.snapshot !== tab.snapshot)
      throw new BrowserError('stale-snapshot', 'The page changed since it was read. Take a new snapshot first.')
    return this.agentAction(id, runId, tab.lease.generation, owner, (page) => page.act(action))
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
    const admitted = admitAgentAction(tab.lease, runId, generation)
    if (!admitted.ok)
      throw new BrowserError(admitted.refused, `The agent cannot act on this tab (${admitted.refused}).`)
    tab.lease = admitted.state
    try {
      return await action(tab.page)
    } finally {
      const live = this.tabs.get(id)
      if (live) live.lease = settleAgentAction(live.lease, generation)
    }
  }

  /** A run ended or was stopped: its leases are revoked, its temporary tabs close and user-opened tabs stay. */
  endRun(owner: Required<BrowserOwner>): void {
    for (const tab of [...this.tabs.values()]) {
      if (tab.owner.hostId !== owner.hostId || tab.owner.threadId !== owner.threadId) continue
      if (tab.owner.runId === owner.runId && tab.profileId === TEMPORARY_PROFILE_ID) this.destroy(tab)
      else tab.lease = revokeAgent(tab.lease, owner.runId)
    }
    this.changed()
  }

  closeAll(): void {
    this.closed = true
    for (const tab of [...this.tabs.values()]) this.destroy(tab)
  }
}
