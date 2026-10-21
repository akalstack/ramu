import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { BrowserDialog, BrowserDiagnostics, BrowserKey } from '@ramu/shared/browserBridge'

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
  async key(name: BrowserKey, shift: boolean): Promise<void> {
    const key = Object.hasOwn(keys, name) ? keys[name] : undefined
    if (!key) throw new Error('This key is not supported by the browser tool.')
    await this.ensure()
    const event = { key: key.key, code: key.code, windowsVirtualKeyCode: key.virtual, modifiers: shift ? 8 : 0 }
    try {
      await this.contents.debugger.sendCommand('Input.dispatchKeyEvent', {
        ...event,
        type: key.text ? 'keyDown' : 'rawKeyDown',
        ...(key.text ? { text: key.text } : {}),
      })
    } finally {
      await this.contents.debugger.sendCommand('Input.dispatchKeyEvent', { ...event, type: 'keyUp' }).catch(() => {})
    }
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
