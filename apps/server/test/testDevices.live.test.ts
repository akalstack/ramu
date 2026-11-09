import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TestDevices } from '../src/testDevice/testDevices'

// Leases real simulators and emulators from Simlock on this machine (set up with Settings → Test devices first).
// Opt in with RAMU_LIVE_DEVICES=1; each device is deleted when its thread lets go.
const live = process.env.RAMU_LIVE_DEVICES === '1'

describe.skipIf(!live)('test devices on Simlock on this machine', () => {
  const notes: { taskId: string; text: string }[] = []
  const devices = new TestDevices(() => true, { notify: (taskId, text) => notes.push({ taskId, text }) })
  afterAll(() => devices.stopAll())

  it('reports readiness and the models that can be leased', async () => {
    const status = await devices.status()
    expect(status.installed).toBe(true)
    expect(status.models.ios.length + status.models.android.length).toBeGreaterThan(0)
  })

  it('gives a thread an iPhone of its own, lists elements, taps by ref and keeps paths inside the workspace', async () => {
    const opened = await devices.open('thread-a', { platform: 'ios' })
    expect(opened.name).toMatch(/iOS/)
    expect((await devices.status()).inUse.map((entry) => entry.taskId)).toEqual(['thread-a'])
    await devices.launch('thread-a', 'com.apple.Preferences')
    const backend = devices.backend('thread-a')
    const frame = await backend.capture(devices.target('thread-a'))
    expect(frame.width).toBeGreaterThan(600)
    expect(frame.text).toMatch(/@e\d+ .*"General"/)
    const general = /@(e\d+) [^\n]*"General"[^\n]*@(\d+),(\d+)/.exec(frame.text!)!
    await backend.perform(devices.target('thread-a'), {
      kind: 'click',
      x: Number(general[2]),
      y: Number(general[3]),
      ref: general[1],
    })
    const after = await backend.capture(devices.target('thread-a'))
    expect(after.text).toMatch(/"About"/)
    const workspace = mkdtempSync(join(tmpdir(), 'ramu-ws-'))
    await expect(devices.install('thread-a', workspace, '../../etc/hosts')).rejects.toThrow()
    await expect(devices.install('thread-a', workspace, '/etc/hosts')).rejects.toThrow(/relative/)
    mkdirSync(join(workspace, 'App.app'))
    writeFileSync(join(workspace, 'notes.txt'), 'x')
    await expect(devices.install('thread-a', workspace, 'notes.txt')).rejects.toThrow(/\.app/)
    await devices.rotate('thread-a', 'landscape-left')
    await devices.releaseThread('thread-a')
    expect((await devices.status()).inUse).toEqual([])
  }, 900_000)

  it('gives a thread an Android emulator with its elements, then lets it go', async () => {
    if (!(await devices.status()).android.ready) return
    await devices.open('thread-c', { platform: 'android' })
    const backend = devices.backend('thread-c')
    await backend.perform(devices.target('thread-c'), { kind: 'key', key: 'Home' })
    const frame = await backend.capture(devices.target('thread-c'))
    expect(frame.width).toBeGreaterThan(600)
    expect(frame.text).toMatch(/@e\d+/)
    await devices.releaseThread('thread-c')
  }, 900_000)
})
