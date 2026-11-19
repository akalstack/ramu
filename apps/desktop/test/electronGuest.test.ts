import { beforeEach, expect, it, vi } from 'vitest'
import { ElectronGuestFactory } from '../src/main/electronGuest'

const mock = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => void>(),
  execute: vi.fn(),
  permission: vi.fn(),
  check: vi.fn(),
  userAgent: vi.fn(),
  sessionListeners: new Map<string, (...args: any[]) => void>(),
  preferences: {} as Record<string, unknown>,
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: mock.permission,
      setPermissionCheckHandler: mock.check,
      getUserAgent: () =>
        'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ramu/0.1.0 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36',
      setUserAgent: mock.userAgent,
      on: (event: string, listener: (...args: any[]) => void) => mock.sessionListeners.set(event, listener),
    }),
  },
  WebContentsView: class {
    constructor(options: { webPreferences: Record<string, unknown> }) {
      mock.preferences = options.webPreferences
    }
    webContents = {
      getURL: () => 'https://www.youtube.com/watch?v=example',
      setWindowOpenHandler() {},
      on: (event: string, listener: (...args: any[]) => void) => mock.listeners.set(event, listener),
      executeJavaScriptInIsolatedWorld: mock.execute,
    }
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  mock.listeners.clear()
  mock.sessionListeners.clear()
})
const create = () =>
  new ElectronGuestFactory(() => null).create('persist:ramu-browser:default', {
    onNavigate: () => true,
    onOpenWindow() {},
    onCrash() {},
  })

it('tracks a site favicon, rejects another origin and clears the icon on navigation', () => {
  const page = create()
  mock.listeners.get('page-favicon-updated')!({}, [
    'https://tracking.test/icon.png',
    'https://www.youtube.com/favicon.ico',
  ])
  expect(page.favicon?.()).toBe('https://www.youtube.com/favicon.ico')
  mock.listeners.get('did-navigate')!()
  expect(page.favicon?.()).toBeNull()
})

it('keeps the page sandboxed without a preload and denies permissions and downloads', () => {
  create()
  expect(mock.preferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
  })
  expect(mock.preferences).not.toHaveProperty('preload')
  // Sign-in pages refuse an embedded browser that names Electron or the app.
  expect(mock.userAgent).toHaveBeenCalledWith(
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36',
  )
  const answer = vi.fn()
  mock.permission.mock.calls[0]![0](null, 'camera', answer)
  expect(answer).toHaveBeenCalledWith(false)
  expect(mock.check.mock.calls[0]![0]()).toBe(false)
  const preventDefault = vi.fn()
  mock.sessionListeners.get('will-download')!({ preventDefault })
  expect(preventDefault).toHaveBeenCalled()
})

it('takes this computer’s mouse and keyboard only while this computer controls the page, and revokes them at once', () => {
  const page = create()
  const event = { preventDefault: vi.fn() }
  for (const name of ['before-input-event', 'before-mouse-event']) mock.listeners.get(name)!(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  page.setHumanInput(true, true)
  mock.listeners.get('before-mouse-event')!(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  // Another of the person's devices controls it: the page takes that device's input, not this computer's.
  page.setHumanInput(true, false)
  mock.listeners.get('before-mouse-event')!(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(3)
  page.setHumanInput(false)
  mock.listeners.get('before-input-event')!(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(4)
})

it('executes fixed inspection/action code in a separate world with caller text encoded as data', async () => {
  const page = create()
  mock.execute.mockResolvedValue({ ok: true })
  const text = '"); globalThis.compromised = true; //'
  await page.inspect()
  await page.act({ kind: 'type', ref: 2, snapshot: 3, text, submit: false })
  const [world, scripts] = mock.execute.mock.calls[1]!
  expect(world).toBe(999)
  expect(scripts).toHaveLength(1)
  expect(scripts[0].code).toContain(JSON.stringify(text))
  expect(scripts[0].code).not.toContain('require(')
})
