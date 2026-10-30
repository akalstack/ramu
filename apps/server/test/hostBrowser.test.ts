import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostBrowser, MAX_VIEWER_FRAME_CHARS } from '../src/browser/hostBrowser'

let dir: string
let browser: HostBrowser
let runtime: Record<string, ReturnType<typeof vi.fn>> & { controllerDisconnected: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'ramu-hostbrowser-'))
  browser = new HostBrowser(dir, () => {})
  runtime = {
    list: vi.fn(() => [{ id: 'tab1' }]),
    controllerDisconnected: vi.fn(),
    captureForViewer: vi.fn(async () => ({ mimeType: 'image/jpeg', data: 'AAAA', width: 10, height: 10 })),
    takeControl: vi.fn(() => ({ id: 'tab1', controller: 'human' })),
    closeAll: vi.fn(),
    endRun: vi.fn(),
  }
  ;(browser as unknown as { runtime: unknown }).runtime = runtime
})

afterEach(async () => {
  vi.useRealTimers()
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
})

it('enables fresh hosts without downloading a browser at startup', () => {
  const fresh = new HostBrowser(join(dir, 'fresh'), () => {})
  expect(fresh.selected()).toBe(true)
  expect(fresh.status()).toMatchObject({ enabled: true, available: false })
})

it('prefers a connected desktop browser unless Host Chromium is chosen, and remembers the choice', () => {
  const changed = vi.fn()
  const root = join(dir, 'engine')
  const host = new HostBrowser(root, changed)
  let native = false
  host.useNativeWhen(() => native)
  expect(host.selected()).toBe(true)
  native = true
  expect(host.selected()).toBe(false)
  host.setEngine('chromium')
  expect(host.selected()).toBe(true)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(new HostBrowser(root, () => {}).status().engine).toBe('chromium')
  expect(() => host.setEngine('other' as never)).toThrow('Choose')
})

it('uses the paired owner connection without a per-thread viewing grant and rechecks revoked pairing', () => {
  let paired = true
  const owner = new HostBrowser(
    join(dir, 'owner'),
    () => {},
    () => {},
    (device) => paired && device === 'phone',
  )
  ;(owner as unknown as { runtime: unknown }).runtime = runtime
  expect(owner.list('phone', 't1')).toEqual([{ id: 'tab1' }])
  expect(owner.grantsList()).toEqual([])
  paired = false
  expect(() => owner.list('phone', 't1')).toThrow(/not granted/)
  owner.disconnect('phone')
})

it('does not run a queued browser action when the run stops during first-use preparation', async () => {
  let finish!: () => void
  vi.spyOn(browser, 'prepare').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const action = browser.request('t1', 'r1', { kind: 'list' })
  const refused = expect(action).rejects.toThrow(/run ended/)
  browser.endRun('t1', 'r1')
  finish()
  await refused
  expect(runtime.list).not.toHaveBeenCalled()
})

describe('host browser device grants', () => {
  it('refuses a paired device that was never granted, and lets the owning host through', () => {
    expect(() => browser.list('phone', 't1')).toThrow(/not granted/)
    expect(browser.list('local', 't1')).toEqual([{ id: 'tab1' }])
    browser.grant('phone', 't1')
    expect(browser.list('phone', 't1')).toEqual([{ id: 'tab1' }])
    // The grant is for one thread only.
    expect(() => browser.list('phone', 't2')).toThrow(/not granted/)
  })

  it('expires a grant after an hour and releases the device’s control when it lapses', () => {
    browser.grant('phone', 't1')
    vi.advanceTimersByTime(60 * 60_000 + 1)
    expect(browser.grantsList()).toEqual([])
    expect(() => browser.list('phone', 't1')).toThrow(/not granted/)
    expect(runtime.controllerDisconnected).toHaveBeenCalledWith('phone')
  })

  it('caps the number of grants but still renews an existing one', () => {
    for (let i = 0; i < 100; i++) browser.grant(`d${i}`, 't')
    expect(() => browser.grant('extra', 't')).toThrow(/Remove a browser device grant/)
    expect(() => browser.grant('d5', 't')).not.toThrow()
  })

  it('revoking a grant drops control and stops the device’s heartbeat', () => {
    browser.grant('phone', 't1')
    browser.list('phone', 't1')
    browser.revoke('phone', 't1')
    expect(runtime.controllerDisconnected).toHaveBeenCalledWith('phone')
    runtime.controllerDisconnected.mockClear()
    vi.advanceTimersByTime(10_000)
    expect(runtime.controllerDisconnected).not.toHaveBeenCalled()
  })
})

describe('host browser heartbeat', () => {
  it('pauses a device that stops asking, without handing control back', () => {
    browser.grant('phone', 't1')
    browser.list('phone', 't1')
    vi.advanceTimersByTime(4900)
    expect(runtime.controllerDisconnected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(runtime.controllerDisconnected).toHaveBeenCalledWith('phone')
  })

  it('keeps a device alive while it keeps asking', () => {
    browser.grant('phone', 't1')
    for (let i = 0; i < 5; i++) {
      browser.list('phone', 't1')
      vi.advanceTimersByTime(3000)
    }
    expect(runtime.controllerDisconnected).not.toHaveBeenCalled()
  })
})

describe('host browser frames', () => {
  it('limits how often a device can request a frame', async () => {
    browser.grant('phone', 't1')
    await browser.frame('phone', 't1', 'tab1')
    await expect(browser.frame('phone', 't1', 'tab1')).rejects.toThrow(/Wait before/)
    vi.advanceTimersByTime(460)
    await expect(browser.frame('phone', 't1', 'tab1')).resolves.toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('allows only two captures at a time across devices', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    runtime.captureForViewer!.mockImplementation(async () => {
      await gate
      return { mimeType: 'image/jpeg', data: 'AAAA' }
    })
    for (const device of ['a', 'b', 'c']) browser.grant(device, 't1')
    const first = browser.frame('a', 't1', 'tab1')
    const second = browser.frame('b', 't1', 'tab1')
    await expect(browser.frame('c', 't1', 'tab1')).rejects.toThrow(/Wait before/)
    release()
    await Promise.all([first, second])
  })

  it('refuses a frame that is too large to stream', async () => {
    runtime.captureForViewer!.mockResolvedValue({
      mimeType: 'image/jpeg',
      data: 'A'.repeat(MAX_VIEWER_FRAME_CHARS + 1),
    })
    await expect(browser.frame('local', 't1', 'tab1')).rejects.toThrow(/too large/)
  })
})

describe('host browser control', () => {
  it('lets a device take only a tab of the thread it was granted', () => {
    browser.grant('phone', 't1')
    expect(browser.take('phone', 't1', 'tab1')).toMatchObject({ controller: 'human' })
    expect(runtime.takeControl).toHaveBeenCalledWith('tab1', 'phone', { local: false })
    runtime.list!.mockReturnValue([{ id: 'other' }])
    expect(() => browser.take('phone', 't1', 'tab1')).toThrow(/another thread/)
  })

  it('an unrelated device cannot disconnect another device', () => {
    browser.grant('phone', 't1')
    browser.disconnect('tablet')
    expect(runtime.controllerDisconnected).toHaveBeenCalledWith('tablet')
    expect(browser.grantsList()).toHaveLength(1)
  })
})

it('does not deliver a pending live frame after pairing is revoked or the viewer disconnects', async () => {
  let finish!: (frame: unknown) => void
  runtime.nextFrameForViewer = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  browser.grant('phone', 't1')
  const pending = browser.nextFrame('phone', 't1', 'tab1', 0)
  const refused = expect(pending).rejects.toThrow('not granted')
  browser.revoke('phone', 't1')
  finish({ sequence: 1, data: 'private' })
  await refused
  browser.grant('phone', 't1')
  const disconnected = browser.nextFrame('phone', 't1', 'tab1', 0)
  const dropped = expect(disconnected).rejects.toThrow('disconnected')
  browser.disconnect('phone')
  finish({ sequence: 2, data: 'private' })
  await dropped
})

it('bounds outstanding live frame reads independently from screenshot captures', async () => {
  let finish!: (frame: unknown) => void
  runtime.nextFrameForViewer = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const read = browser.nextFrame('local', 't1', 'tab1', 0)
  await expect(browser.nextFrame('local', 't1', 'tab1', 0)).rejects.toThrow('busy')
  expect(await browser.frame('local', 't1', 'tab1')).toHaveProperty('data', 'AAAA')
  finish(null)
  expect(await read).toBeNull()
})
