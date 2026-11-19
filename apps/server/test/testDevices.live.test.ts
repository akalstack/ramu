import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { TestDevices } from '../src/testDevice/testDevices'
import { annexB } from '../src/testDevice/deviceVideo'

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
    // Take control: the person's Back and tap go over the lease's input socket.
    await backend.perform(devices.target('thread-a'), { kind: 'key', key: 'Back' }, { byPerson: true })
    await new Promise((done) => setTimeout(done, 1500))
    const back = await backend.capture(devices.target('thread-a'))
    const again = /"General"[^\n]*@(\d+),(\d+)/.exec(back.text!)!
    expect(again).not.toBeNull()
    await backend.perform(
      devices.target('thread-a'),
      { kind: 'click', x: Number(again[1]), y: Number(again[2]) },
      { byPerson: true },
    )
    await new Promise((done) => setTimeout(done, 1500))
    expect((await backend.capture(devices.target('thread-a'))).text).toMatch(/"About"/)
    const workspace = mkdtempSync(join(tmpdir(), 'ramu-ws-'))
    await expect(devices.install('thread-a', workspace, '../../etc/hosts')).rejects.toThrow()
    await expect(devices.install('thread-a', workspace, '/etc/hosts')).rejects.toThrow(/relative/)
    mkdirSync(join(workspace, 'App.app'))
    writeFileSync(join(workspace, 'notes.txt'), 'x')
    await expect(devices.install('thread-a', workspace, 'notes.txt')).rejects.toThrow(/\.app/)
    // The live picture: a key frame first, led by its parameter sets, that ffprobe decodes at the stream's size.
    const units: { key: boolean; nalus: Buffer[] }[] = []
    const { info, unsubscribe } = await devices.video('thread-a').subscribe((unit) => units.push(unit))
    // A still screen sends no video; scrolling makes the picture change.
    await backend.perform(devices.target('thread-a'), { kind: 'scroll', x: 600, y: 1800, dx: 0, dy: 900 })
    await new Promise((done) => setTimeout(done, 3000))
    unsubscribe()
    expect(info.width).toBeGreaterThan(600)
    expect(units[0]!.key).toBe(true)
    expect(units[0]!.nalus.slice(0, 2).map((nal) => nal[0]! & 0x1f)).toEqual([7, 8])
    const file = join(workspace, 'screen.h264')
    writeFileSync(file, annexB(units.flatMap((unit) => unit.nalus)))
    const probe = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    )
    expect(probe.trim()).toBe(`${info.width},${info.height}`)
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
