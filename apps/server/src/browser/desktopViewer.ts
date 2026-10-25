import type {
  BrowserDialog,
  BrowserFieldFocus,
  BrowserLiveFrame,
  BrowserHumanInput,
  BrowserPageSnapshot,
  BrowserScreenshot,
  BrowserViewerOperation,
} from '@ramu/shared/browserBridge'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { DesktopBrowserBroker } from './desktopBroker'
import { MAX_VIEWER_FRAME_CHARS } from './hostBrowser'

/**
 * What a paired device does with a thread's browser tabs. The host-managed Chromium and the attached desktop's
 * browser both answer it, so one viewer works with either.
 */
export interface BrowserViewerBackend {
  list(device: string, thread: string): BrowserTabInfo[] | Promise<BrowserTabInfo[]>
  open(
    device: string,
    thread: string,
    url: string,
    profileId?: string,
  ): Promise<{ tab: BrowserTabInfo; profileFellBack: boolean }>
  closeTab(device: string, thread: string, tabId: string): void | Promise<void>
  history(device: string, thread: string, tabId: string, direction: 'back' | 'forward' | 'reload'): unknown
  dialog(device: string, thread: string, tabId: string): BrowserDialog | null | Promise<BrowserDialog | null>
  answerDialog(device: string, thread: string, tabId: string, dialogId: string, accept: boolean, text?: string): unknown
  frame(device: string, thread: string, tabId: string): Promise<BrowserScreenshot>
  nextFrame(device: string, thread: string, tabId: string, after: number): Promise<BrowserLiveFrame | null>
  read(device: string, thread: string, tabId: string): Promise<BrowserPageSnapshot>
  take(device: string, thread: string, tabId: string): BrowserTabInfo | Promise<BrowserTabInfo>
  release(device: string, thread: string, tabId: string, runId?: string): BrowserTabInfo | Promise<BrowserTabInfo>
  input(device: string, thread: string, tabId: string, generation: number, input: BrowserHumanInput): Promise<void>
  navigate(device: string, thread: string, tabId: string, url: string): Promise<BrowserTabInfo>
  focus(device: string, thread: string, tabId: string): Promise<BrowserFieldFocus>
  fit(
    device: string,
    thread: string,
    tabId: string,
    size: { width: number; height: number } | null,
  ): { fitted: boolean } | Promise<{ fitted: boolean }>
  disconnect(device: string): void | Promise<void>
}

/** The attached desktop's browser, viewed through its existing private event stream. Nothing is replayed on failure. */
export class DesktopBrowserViewer implements BrowserViewerBackend {
  private readonly heartbeats = new Map<string, { timer: NodeJS.Timeout; threads: Set<string> }>()
  private readonly frameTimes = new Map<string, number>()
  private captures = 0
  private readonly liveRequests = new Set<string>()
  constructor(private readonly broker: DesktopBrowserBroker) {}

  private run<T>(device: string, thread: string, operation: BrowserViewerOperation): Promise<T> {
    this.touch(device, thread)
    return this.broker.view(thread, { kind: 'viewer', device, operation }) as Promise<T>
  }
  /** Five seconds without a request pauses a device's control, as the host browser does. */
  private touch(device: string, thread: string): void {
    const previous = this.heartbeats.get(device)
    if (previous) clearTimeout(previous.timer)
    const threads = previous?.threads ?? new Set<string>()
    threads.add(thread)
    const timer = setTimeout(() => {
      this.heartbeats.delete(device)
      this.frameTimes.delete(device)
      this.release_(device, threads)
    }, 5000)
    timer.unref()
    this.heartbeats.set(device, { timer, threads })
  }
  private release_(device: string, threads: Iterable<string>): void {
    for (const thread of threads)
      void this.broker.view(thread, { kind: 'viewer', device, operation: { op: 'disconnect' } }).catch(() => {})
  }
  list(device: string, thread: string) {
    return this.run<BrowserTabInfo[]>(device, thread, { op: 'list' })
  }
  open(device: string, thread: string, url: string, profileId?: string) {
    return this.run<{ tab: BrowserTabInfo; profileFellBack: boolean }>(device, thread, { op: 'open', url, profileId })
  }
  async closeTab(device: string, thread: string, tabId: string) {
    await this.run(device, thread, { op: 'close', tabId })
  }
  history(device: string, thread: string, tabId: string, direction: 'back' | 'forward' | 'reload') {
    return this.run(device, thread, { op: 'history', tabId, direction })
  }
  dialog(device: string, thread: string, tabId: string) {
    return this.run<BrowserDialog | null>(device, thread, { op: 'dialog', tabId })
  }
  answerDialog(device: string, thread: string, tabId: string, dialogId: string, accept: boolean, text?: string) {
    return this.run(device, thread, { op: 'answerDialog', tabId, dialogId, accept, text })
  }
  async frame(device: string, thread: string, tabId: string) {
    const now = Date.now()
    if (this.captures >= 2 || now - (this.frameTimes.get(device) ?? 0) < 450)
      throw new Error('Wait before requesting another browser frame.')
    this.frameTimes.set(device, now)
    this.captures++
    try {
      const image = await this.run<BrowserScreenshot>(device, thread, { op: 'frame', tabId })
      if (image.data.length > MAX_VIEWER_FRAME_CHARS)
        throw new Error('This page is too large to stream. Make the page smaller and try again.')
      return image
    } finally {
      this.captures--
    }
  }
  async nextFrame(device: string, thread: string, tabId: string, after: number) {
    const key = JSON.stringify([device, thread, tabId])
    if (this.liveRequests.size >= 8 || this.liveRequests.has(key)) throw new Error('The browser viewer is busy.')
    this.liveRequests.add(key)
    try {
      return await this.run<BrowserLiveFrame | null>(device, thread, { op: 'nextFrame', tabId, after })
    } finally {
      this.liveRequests.delete(key)
    }
  }
  read(device: string, thread: string, tabId: string) {
    return this.run<BrowserPageSnapshot>(device, thread, { op: 'read', tabId })
  }
  take(device: string, thread: string, tabId: string) {
    return this.run<BrowserTabInfo>(device, thread, { op: 'take', tabId })
  }
  release(device: string, thread: string, tabId: string, runId?: string) {
    return this.run<BrowserTabInfo>(device, thread, { op: 'release', tabId, runId })
  }
  async input(device: string, thread: string, tabId: string, generation: number, input: BrowserHumanInput) {
    await this.run(device, thread, { op: 'input', tabId, generation, input })
  }
  navigate(device: string, thread: string, tabId: string, url: string) {
    return this.run<BrowserTabInfo>(device, thread, { op: 'navigate', tabId, url })
  }
  focus(device: string, thread: string, tabId: string) {
    return this.run<BrowserFieldFocus>(device, thread, { op: 'focus', tabId })
  }
  /** The desktop shows this page to the person at the computer, so a phone never changes its layout. */
  fit() {
    return { fitted: false }
  }
  disconnect(device: string): void {
    const entry = this.heartbeats.get(device)
    if (entry) clearTimeout(entry.timer)
    this.heartbeats.delete(device)
    this.frameTimes.delete(device)
    this.release_(device, entry?.threads ?? [])
  }
}
