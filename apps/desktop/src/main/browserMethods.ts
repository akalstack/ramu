import type { BrowserRuntime, TabInfo } from './browserRuntime'

type Bounds = { x: number; y: number; width: number; height: number }

const text = (value: unknown, label: string, max = 4000): string => {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Invalid ${label}`)
  return value
}
const validBounds = (value: unknown): Bounds => {
  const b = value as Partial<Bounds> | null
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20_000
  if (!b || !ok(b.x) || !ok(b.y) || !ok(b.width) || !ok(b.height)) throw new Error('Invalid bounds')
  return { x: b.x!, y: b.y!, width: b.width!, height: b.height! }
}

/**
 * Browser calls from the workspace window. They run in the desktop shell only: the window supplies the host and thread
 * it shows, the shell validates every argument, and tab identity, profile and control stay with the runtime. A window
 * can only act on tabs of the thread it names.
 */
export function browserMethod(runtime: BrowserRuntime, method: string, args: unknown[]): unknown {
  const owned = (hostId: string, threadId: string, tabId: string): TabInfo => {
    const tab = runtime.list({ hostId, threadId }).find((entry) => entry.id === tabId)
    if (!tab) throw new Error('That tab is closed.')
    return tab
  }
  switch (method) {
    case 'browser.list':
      return runtime.list({ hostId: text(args[0], 'host', 200), threadId: text(args[1], 'thread', 200) })
    case 'browser.open':
      return runtime.open(
        { hostId: text(args[0], 'host', 200), threadId: text(args[1], 'thread', 200) },
        text(args[2], 'address'),
        typeof args[3] === 'string' ? args[3] : undefined,
      )
    case 'browser.navigate': {
      const [hostId, threadId, tabId] = [
        text(args[0], 'host', 200),
        text(args[1], 'thread', 200),
        text(args[2], 'tab', 100),
      ]
      owned(hostId, threadId, tabId)
      return runtime.navigate(tabId, text(args[3], 'address'))
    }
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
    case 'browser.close':
    case 'browser.hide':
    case 'browser.takeControl': {
      const [hostId, threadId, tabId] = [
        text(args[0], 'host', 200),
        text(args[1], 'thread', 200),
        text(args[2], 'tab', 100),
      ]
      owned(hostId, threadId, tabId)
      if (method === 'browser.takeControl') return runtime.takeControl(tabId, 'local', { local: true })
      return runtime[method.slice('browser.'.length) as 'back' | 'forward' | 'reload' | 'close' | 'hide'](tabId)
    }
    case 'browser.show': {
      const [hostId, threadId, tabId] = [
        text(args[0], 'host', 200),
        text(args[1], 'thread', 200),
        text(args[2], 'tab', 100),
      ]
      owned(hostId, threadId, tabId)
      return runtime.show(tabId, validBounds(args[3]))
    }
    default:
      throw new Error(`Unknown method ${method}`)
  }
}

export const isBrowserMethod = (method: string): boolean => method.startsWith('browser.')
