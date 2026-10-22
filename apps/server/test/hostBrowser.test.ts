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
  }
  ;(browser as unknown as { runtime: unknown }).runtime = runtime
})

afterEach(async () => {
  vi.useRealTimers()
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
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
    runtime.captureForViewer!.mockResolvedValue({ mimeType: 'image/jpeg', data: 'A'.repeat(MAX_VIEWER_FRAME_CHARS + 1) })
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
