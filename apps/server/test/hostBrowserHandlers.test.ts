import { describe, expect, it, vi } from 'vitest'
import { registerHostBrowserHandlers } from '../src/ipc/handlers/hostBrowser'
import type { HandlerContext } from '../src/ipc/types'

const THREAD = 'thread-1'
const TAB = '11111111-1111-4111-8111-111111111111'

function setup(
  options: { admin?: boolean; deviceId?: string | undefined; eligible?: boolean; running?: boolean } = {},
) {
  const hostBrowser = {
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
    expect(() => remote.call('hostBrowser.disable')).toThrow(/owning host/)
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
  })
})
