import { describe, expect, it, vi } from 'vitest'
import { registerHostBrowserHandlers } from '../src/ipc/handlers/hostBrowser'
import type { HandlerContext } from '../src/ipc/types'

const THREAD = 'thread-1'
const TAB = '11111111-1111-4111-8111-111111111111'

function setup(
  options: {
    admin?: boolean
    deviceId?: string | undefined
    eligible?: boolean
    running?: boolean
    hostSelected?: boolean
    desktop?: { ready: boolean; view?: ReturnType<typeof vi.fn> }
  } = {},
) {
  const hostBrowser = {
    selected: () => options.hostSelected ?? true,
    status: vi.fn(() => ({ available: true })),
    setup: vi.fn(),
    prepare: vi.fn(async () => {}),
    disable: vi.fn(),
    grant: vi.fn(),
    revoke: vi.fn(),
    list: vi.fn(() => []),
    release: vi.fn(),
    input: vi.fn(),
    take: vi.fn(),
  }
  const ctx = {
    hostBrowser,
    browser: options.desktop && { isReady: () => options.desktop!.ready, view: options.desktop.view ?? vi.fn() },
    host: {
      canAdministerIntegrations: () => options.admin ?? false,
      browserDevice: () => ('deviceId' in options ? options.deviceId : 'phone'),
      browserGrantEligible: () => options.eligible ?? true,
    },
    workspace: { getTask: vi.fn() },
    agents: {
      list: () => (options.running ? [{ id: 'run1', parentId: undefined, state: 'running' }] : []),
    },
    loadPreferences: vi.fn(),
    savePreferences: vi.fn(),
  } as unknown as HandlerContext
  const methods = registerHostBrowserHandlers(ctx)
  const call = (name: string, ...args: unknown[]) =>
    methods[name]!.run(...(methods[name]!.args.parse(args) as unknown[]))
  return { call, hostBrowser, methods }
}

describe('host browser handlers', () => {
  it('keeps setup and grants on the owning host', () => {
    const remote = setup({ admin: false })
    expect(() => remote.call('hostBrowser.setup')).toThrow(/owning host/)
    expect(() => remote.call('hostBrowser.grant', 'phone', THREAD)).toThrow(/owning host/)
    expect(() => remote.call('hostBrowser.stop')).toThrow(/owning host/)
    const owner = setup({ admin: true })
    owner.call('hostBrowser.setup')
    expect(owner.hostBrowser.setup).toHaveBeenCalled()
  })

  it('grants only paired owner devices, never a viewer', () => {
    const viewer = setup({ admin: true, eligible: false })
    expect(() => viewer.call('hostBrowser.grant', 'tablet', THREAD)).toThrow(/Viewer pairing grants no browser access/)
    expect(viewer.hostBrowser.grant).not.toHaveBeenCalled()
    const owner = setup({ admin: true, eligible: true })
    owner.call('hostBrowser.grant', 'tablet', THREAD)
    expect(owner.hostBrowser.grant).toHaveBeenCalledWith('tablet', THREAD)
  })

  it('refuses viewing from a caller with no paired identity', async () => {
    const anonymous = setup({ deviceId: undefined })
    await expect(anonymous.call('hostBrowser.list', THREAD)).rejects.toThrow(/Pair this device/)
  })

  it('opens the browser for a paired owner without a separate grant', async () => {
    const owner = setup()
    await owner.call('hostBrowser.list', THREAD)
    expect(owner.hostBrowser.prepare).toHaveBeenCalled()
    expect(owner.hostBrowser.list).toHaveBeenCalledWith('phone', THREAD)
    expect(owner.hostBrowser.grant).not.toHaveBeenCalled()
    const viewer = setup({ eligible: false })
    await expect(viewer.call('hostBrowser.list', THREAD)).rejects.toThrow(/owner device/)
    expect(viewer.hostBrowser.prepare).not.toHaveBeenCalled()
  })

  it('on release hands the tab to the live run, or keeps it for the next run when nothing is running', () => {
    const running = setup({ running: true })
    running.call('hostBrowser.release', THREAD, TAB)
    expect(running.hostBrowser.release).toHaveBeenCalledWith('phone', THREAD, TAB, 'run1')
    const idle = setup({ running: false })
    idle.call('hostBrowser.release', THREAD, TAB)
    expect(idle.hostBrowser.release).toHaveBeenCalledWith('phone', THREAD, TAB, undefined)
  })

  it('validates what a phone can send as input', () => {
    const { methods } = setup()
    const parse = (input: unknown) => methods['hostBrowser.input']!.args.safeParse([THREAD, TAB, 3, input]).success
    expect(parse({ kind: 'click', x: 0.5, y: 0.5, button: 'left', clickCount: 1 })).toBe(true)
    expect(parse({ kind: 'click', x: 1.5, y: 0.5, button: 'left', clickCount: 1 })).toBe(false)
    expect(parse({ kind: 'click', x: 0.5, y: 0.5, button: 'left', clickCount: 3 })).toBe(false)
    expect(parse({ kind: 'key', key: 'Enter' })).toBe(true)
    expect(parse({ kind: 'key', key: 'F13' })).toBe(false)
    expect(parse({ kind: 'text', text: 'hello' })).toBe(true)
    expect(parse({ kind: 'text', text: '' })).toBe(false)
    expect(parse({ kind: 'text', text: 'x'.repeat(2001) })).toBe(false)
    expect(parse({ kind: 'scroll', x: 5000, y: 0 })).toBe(false)
    expect(
      methods['hostBrowser.input']!.args.safeParse([THREAD, 'not-a-uuid', 3, { kind: 'key', key: 'Tab' }]).success,
    ).toBe(false)
    expect(methods['hostBrowser.navigate']!.args.safeParse([THREAD, TAB, 'not a url']).success).toBe(false)
    const adjust = (change: unknown) => methods['hostBrowser.adjust']!.args.safeParse([THREAD, TAB, change]).success
    expect(adjust({ zoom: 1.25 })).toBe(true)
    expect(adjust({ zoom: 1.3 })).toBe(false)
    expect(adjust({ colorScheme: 'dark' })).toBe(true)
    expect(adjust({ hardReload: true, zoom: 2 })).toBe(false)
    expect(adjust({ clearCookies: true })).toBe(false)
    const fit = (size: unknown) => methods['hostBrowser.fit']!.args.safeParse([THREAD, TAB, size]).success
    expect(fit({ width: 390, height: 700 })).toBe(true)
    expect(fit(null)).toBe(true)
    expect(fit({ width: 100, height: 700 })).toBe(false)
    expect(fit({ width: 320, height: 200 })).toBe(true)
    expect(fit({ width: 320, height: 100 })).toBe(false)
    expect(fit({ width: 390.5, height: 700 })).toBe(false)
  })

  it('shows a paired device the desktop browser when the host browser is off', async () => {
    const view = vi.fn(async (_thread: string, command: { operation: { op: string } }) =>
      command.operation.op === 'list' ? [{ id: TAB }] : null,
    )
    const desktop = setup({ hostSelected: false, desktop: { ready: true, view } })
    await expect(desktop.call('hostBrowser.list', THREAD)).resolves.toEqual([{ id: TAB }])
    expect(view).toHaveBeenCalledWith(THREAD, { kind: 'viewer', device: 'phone', operation: { op: 'list' } })
    expect(desktop.hostBrowser.list).not.toHaveBeenCalled()
    expect(desktop.hostBrowser.prepare).not.toHaveBeenCalled()
    expect(desktop.call('hostBrowser.status')).toMatchObject({ viewable: true })
    expect(setup({ hostSelected: false, desktop: { ready: false } }).call('hostBrowser.status')).toMatchObject({
      viewable: false,
    })
    expect(setup().call('hostBrowser.status')).toMatchObject({ viewable: true })
  })

  it('keeps file transfers on the host browser, and lists no desktop downloads', async () => {
    const desktop = setup({ hostSelected: false, desktop: { ready: true } })
    expect(desktop.call('hostBrowser.downloads', THREAD)).toEqual([])
    expect(() => desktop.call('hostBrowser.allowDownload', THREAD, TAB)).toThrow(/cannot send or receive files/)
    await expect(desktop.call('hostBrowser.upload', THREAD, TAB, 1, 1, 1, 'a.txt', 0)).rejects.toThrow(
      /cannot send or receive files/,
    )
  })
})
