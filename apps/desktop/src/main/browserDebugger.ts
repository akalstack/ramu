import { BrowserFrames, type CompositorFrame } from '@ramu/server/browserFrames'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { BrowserViewport } from '@ramu/shared/types/browser'
import type {
  BrowserDialog,
  BrowserDiagnostics,
  BrowserHumanInput,
  BrowserKey,
  BrowserModifier,
} from '@ramu/shared/browserBridge'

const keys: Record<BrowserKey, { key: string; code: string; virtual: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', virtual: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', virtual: 27 },
  Tab: { key: 'Tab', code: 'Tab', virtual: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', virtual: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', virtual: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', virtual: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtual: 39 },
  Backspace: { key: 'Backspace', code: 'Backspace', virtual: 8 },
  Delete: { key: 'Delete', code: 'Delete', virtual: 46 },
  Space: { key: ' ', code: 'Space', virtual: 32, text: ' ' },
  Home: { key: 'Home', code: 'Home', virtual: 36 },
  End: { key: 'End', code: 'End', virtual: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', virtual: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', virtual: 34 },
}
const SHORTCUT_COMMANDS: Record<string, string[]> = {
  a: ['selectAll'],
  c: ['copy'],
  v: ['paste'],
  x: ['cut'],
  z: ['undo'],
  y: ['redo'],
  'z+shift': ['redo'],
}
const originOf = (value: unknown) => {
  try {
    const url = new URL(typeof value === 'string' ? value : '')
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '[non-web]'
  } catch {
    return '[unknown]'
  }
}

/** Private fixed CDP operations only: no public debug port, arbitrary evaluation, cookies, request bodies or headers. */
export class BrowserDebugger {
  private frames?: BrowserFrames
  private ready: Promise<void> | undefined
  private disposed = false
  private pendingDialog: BrowserDialog | null = null
  private readonly requests = new Map<string, { method: string; origin: string }>()
  private readonly network: BrowserDiagnostics['network'] = []
  private truncated = false
  constructor(
    private readonly contents: WebContents,
    private readonly changed: () => void,
  ) {
    contents.debugger.on('message', (_event, method, params) => this.message(method, params as Record<string, unknown>))
    contents.debugger.on('detach', () => {
      this.frames?.close()
      this.frames = undefined
      this.ready = undefined
      this.pendingDialog = null
      this.requests.clear()
      this.changed()
    })
  }
  ensure(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('That browser tab is closed.'))
    if (!this.ready) {
      this.ready = (async () => {
        if (!this.contents.debugger.isAttached()) this.contents.debugger.attach('1.3')
        await Promise.all([
          this.contents.debugger.sendCommand('Page.enable'),
          // A page driven from a phone or the agent is often not the focused window; without this a click there never
          // focuses the field, so typing goes nowhere and the phone cannot tell a text field was tapped.
          this.contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }),
          this.contents.debugger.sendCommand('Network.enable', {
            maxTotalBufferSize: 65536,
            maxResourceBufferSize: 8192,
            maxPostDataSize: 0,
          }),
        ])
      })().catch(() => {
        this.ready = undefined
        throw new Error(
          'Browser automation could not attach. Close DevTools for this page and retry the explicit operation.',
        )
      })
    }
    return this.ready
  }
  async nextFrame(after: number) {
    await this.ensure()
    this.frames ??= new BrowserFrames({
      send: (method, params) => this.contents.debugger.sendCommand(method, params),
      listen: (receive) => {
        const listener = (_event: unknown, method: string, params: CompositorFrame) => {
          if (method === 'Page.screencastFrame') receive(params)
        }
        this.contents.debugger.on('message', listener)
        return () => this.contents.debugger.removeListener('message', listener)
      },
    })
    return this.frames.next(after)
  }
  private message(method: string, data: Record<string, unknown>) {
    if (this.disposed) return
    if (
      method === 'Page.javascriptDialogOpening' &&
      ['alert', 'confirm', 'prompt', 'beforeunload'].includes(String(data.type))
    ) {
      this.pendingDialog = {
        id: randomUUID(),
        type: data.type as BrowserDialog['type'],
        message: typeof data.message === 'string' ? data.message.slice(0, 1000) : '',
      }
      this.changed()
    } else if (method === 'Page.javascriptDialogClosed') {
      this.pendingDialog = null
      this.changed()
    } else if (method === 'Network.requestWillBeSent' && typeof data.requestId === 'string') {
      const request = data.request as { method?: unknown; url?: unknown } | undefined
      if (this.requests.size >= 200) {
        this.requests.delete(this.requests.keys().next().value!)
        this.truncated = true
      }
      this.requests.set(data.requestId, {
        method: typeof request?.method === 'string' && /^[A-Z]{1,10}$/.test(request.method) ? request.method : '?',
        origin: originOf(request?.url),
      })
    } else if (method === 'Network.responseReceived' && typeof data.requestId === 'string') {
      const response = data.response as { status?: unknown } | undefined
      const request = this.requests.get(data.requestId)
      if (request) {
        this.requests.delete(data.requestId)
        this.push({
          ...request,
          ...(typeof response?.status === 'number' && Number.isFinite(response.status)
            ? { status: Math.round(response.status) }
            : {}),
        })
      }
    } else if (method === 'Network.loadingFailed' && typeof data.requestId === 'string') {
      const request = this.requests.get(data.requestId)
      this.requests.delete(data.requestId)
      if (request)
        this.push({
          ...request,
          error:
            typeof data.errorText === 'string' && /^net::[A-Z0-9_]{1,100}$/.test(data.errorText)
              ? data.errorText
              : 'Request failed',
        })
    }
  }
  private push(item: BrowserDiagnostics['network'][number]) {
    if (this.network.length >= 40) {
      this.network.shift()
      this.truncated = true
    }
    this.network.push(item)
  }
  diagnostics() {
    return { network: this.network.map((entry) => ({ ...entry })), truncated: this.truncated }
  }
  dialog(): BrowserDialog | null {
    return this.pendingDialog ? { ...this.pendingDialog } : null
  }
  /** Presses one key through Chromium input: a named key, one printable character or F1–F12, with modifiers held. */
  async key(name: BrowserKey, shift: boolean, modifiers: readonly BrowserModifier[] = []): Promise<void> {
    const named = Object.hasOwn(keys, name) ? keys[name] : undefined
    const fn = /^F([1-9]|1[0-2])$/.exec(name)
    const char = name.length === 1 ? name : undefined
    let key: { key: string; code: string; virtual: number; text?: string } | undefined = named
    if (!key && fn) key = { key: name, code: name, virtual: 111 + Number(fn[1]) }
    if (!key && char && /^[\x20-\x7e]$/.test(char)) {
      const upper = char.toUpperCase()
      const letter = /^[a-z]$/i.test(char)
      const digit = /^[0-9]$/.test(char)
      key = {
        key: char,
        code: letter ? `Key${upper}` : digit ? `Digit${char}` : char === ' ' ? 'Space' : '',
        virtual: upper.charCodeAt(0),
        text: char,
      }
    }
    if (!key) throw new Error('This key is not supported by the browser tool.')
    await this.ensure()
    const held = new Set(modifiers)
    if (shift) held.add('Shift')
    const mask =
      (held.has('Alt') ? 1 : 0) |
      (held.has('Control') ? 2 : 0) |
      (held.has('Meta') ? 4 : 0) |
      (held.has('Shift') ? 8 : 0)
    // A shortcut chord is not text; Chromium's editing commands do the work for the common ones.
    const chord = held.has('Control') || held.has('Meta') || held.has('Alt')
    const commands =
      chord && char ? SHORTCUT_COMMANDS[char.toLowerCase() + (held.has('Shift') ? '+shift' : '')] : undefined
    const event = { key: key.key, code: key.code, windowsVirtualKeyCode: key.virtual, modifiers: mask }
    const text = key.text && !chord ? (held.has('Shift') ? key.text.toUpperCase() : key.text) : undefined
    try {
      await this.contents.debugger.sendCommand('Input.dispatchKeyEvent', {
        ...event,
        type: text ? 'keyDown' : 'rawKeyDown',
        ...(text ? { text } : {}),
        ...(commands ? { commands } : {}),
      })
    } finally {
      await this.contents.debugger.sendCommand('Input.dispatchKeyEvent', { ...event, type: 'keyUp' }).catch(() => {})
    }
  }
  /** Real pointer input at viewport coordinates: moves first so hover menus open, then presses and releases. */
  async mouse(
    points: readonly { x: number; y: number }[],
    action: { kind: 'click' | 'hover' | 'drag'; button?: 'left' | 'right' | 'middle'; clickCount?: number },
  ): Promise<void> {
    await this.ensure()
    const send = (params: Record<string, unknown>) =>
      this.contents.debugger.sendCommand('Input.dispatchMouseEvent', { pointerType: 'mouse', ...params })
    const [from, to] = [points[0]!, points[1] ?? points[0]!]
    const button = action.button ?? 'left'
    const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4
    await send({ type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 })
    if (action.kind === 'hover') return
    if (action.kind === 'drag') {
      await send({ type: 'mousePressed', x: from.x, y: from.y, button, buttons, clickCount: 1 })
      for (const step of [0.25, 0.5, 0.75, 1])
        await send({
          type: 'mouseMoved',
          x: from.x + (to.x - from.x) * step,
          y: from.y + (to.y - from.y) * step,
          button,
          buttons,
        })
      await send({ type: 'mouseReleased', x: to.x, y: to.y, button, buttons: 0, clickCount: 1 })
      return
    }
    const count = Math.min(3, Math.max(1, action.clickCount ?? 1))
    for (let click = 1; click <= count; click++) {
      await send({ type: 'mousePressed', x: from.x, y: from.y, button, buttons, clickCount: click })
      await send({ type: 'mouseReleased', x: from.x, y: from.y, button, buttons: 0, clickCount: click })
    }
  }
  /**
   * A paired device's input on this page. Taps arrive as fractions of the frame it showed, which is the page's CSS
   * viewport, so they are placed against the current layout size (zoom included).
   */
  async remoteInput(input: BrowserHumanInput): Promise<void> {
    await this.ensure()
    if (input.kind === 'key') {
      const modifiers = (input.modifiers ?? []).map((modifier) =>
        modifier === 'Primary' ? (process.platform === 'darwin' ? 'Meta' : 'Control') : modifier,
      )
      return this.key(input.key, false, modifiers)
    }
    if (input.kind === 'text') {
      await this.contents.debugger.sendCommand('Input.insertText', { text: input.text })
      return
    }
    const metrics = (await this.contents.debugger.sendCommand('Page.getLayoutMetrics')) as {
      cssLayoutViewport: { clientWidth: number; clientHeight: number }
    }
    const { clientWidth: width, clientHeight: height } = metrics.cssLayoutViewport
    if (input.kind === 'scroll') {
      await this.contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: width / 2,
        y: height / 2,
        deltaX: input.x,
        deltaY: input.y,
      })
      return
    }
    await this.mouse([{ x: input.x * width, y: input.y * height }], {
      kind: 'click',
      button: input.button,
      clickCount: input.clickCount,
    })
  }
  private parked: { width: number; height: number } | null = null
  private emulated: BrowserViewport | null = null
  /** A fixed layout size while the page's pane is hidden; `null` gives the page its pane's real size again. */
  async parkedViewport(size: { width: number; height: number } | null): Promise<void> {
    this.parked = size
    await this.applyMetrics()
  }
  /** The agent's chosen layout size, which wins over parking until it is cleared. */
  async emulatedViewport(viewport: BrowserViewport | null): Promise<void> {
    this.emulated = viewport
    await this.applyMetrics()
  }
  get emulatedSize(): BrowserViewport | null {
    return this.emulated
  }
  private async applyMetrics() {
    await this.ensure()
    const size = this.emulated ?? this.parked
    if (size)
      await this.contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 0,
        mobile: this.emulated?.mobile ?? false,
      })
    else await this.contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  }
  /** The page as laid out at an emulated size, which a capture of the pane would crop or stretch. */
  async captureJpeg(quality: number): Promise<string> {
    await this.ensure()
    const result = (await this.contents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality,
    })) as {
      data: string
    }
    return result.data
  }
  /** Follows the page's light or dark preference, or forces one, for this tab only. */
  async colorScheme(value: 'system' | 'light' | 'dark'): Promise<void> {
    await this.ensure()
    await this.contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: value === 'system' ? '' : value }],
    })
  }
  async handleDialog(id: string, accept: boolean, text?: string): Promise<void> {
    if (this.pendingDialog?.id !== id) throw new Error('That website dialog is no longer open.')
    if (text !== undefined && (text.length > 20000 || this.pendingDialog.type !== 'prompt'))
      throw new Error('Text is only supported for a website prompt.')
    await this.contents.debugger.sendCommand('Page.handleJavaScriptDialog', {
      accept,
      ...(text !== undefined ? { promptText: text } : {}),
    })
    if (this.pendingDialog?.id === id) this.pendingDialog = null
    this.changed()
  }
  dispose() {
    this.disposed = true
    this.frames?.close()
    this.pendingDialog = null
    this.requests.clear()
    this.network.length = 0
    try {
      if (this.contents.debugger.isAttached()) this.contents.debugger.detach()
    } catch {
      /* Closing contents may have detached already. */
    }
  }
}
