import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TestDevices } from '../src/testDevice/testDevices'

// Runs against the simulators and emulators on this machine. Opt in with RAMU_LIVE_DEVICES=1.
const live = process.env.RAMU_LIVE_DEVICES === '1'

describe.skipIf(!live)('test devices on this machine', () => {
  const devices = new TestDevices(() => true)

  it('reports readiness and lists devices', async () => {
    const status = await devices.status()
    expect(status.enabled).toBe(true)
    expect(status.devices.length).toBeGreaterThan(0)
  })

  it('opens a booted iOS Simulator, captures it, and refuses paths outside the workspace and other threads', async () => {
    const booted = (await devices.list()).find((device) => device.platform === 'ios' && device.running)
    if (!booted) return
    await devices.open(booted.id, 'thread-a')
    const frame = await devices.backend(booted.id).capture(devices.target(booted.id))
    expect(frame.width).toBeGreaterThan(300)
    expect(frame.data.length).toBeGreaterThan(1000)
    await expect(devices.open(booted.id, 'thread-b')).rejects.toThrow(/Another thread/)
    const workspace = mkdtempSync(join(tmpdir(), 'ramu-ws-'))
    await expect(devices.install(booted.id, 'thread-a', workspace, '../../etc/hosts')).rejects.toThrow()
    await expect(devices.install(booted.id, 'thread-a', workspace, '/etc/hosts')).rejects.toThrow(/relative/)
    mkdirSync(join(workspace, 'App.app'))
    writeFileSync(join(workspace, 'notes.txt'), 'x')
    await expect(devices.install(booted.id, 'thread-a', workspace, 'notes.txt')).rejects.toThrow(/\.app/)
    // A simulator the person already had running is released, not shut down.
    await devices.stop(booted.id)
    expect((await devices.list()).find((device) => device.id === booted.id)?.running).toBe(true)
  }, 120_000)

  it('boots an Android emulator, taps and reads its screen, then shuts it down', async () => {
    const avd = (await devices.list()).find((device) => device.platform === 'android')
    if (!avd) return
    await devices.open(avd.id, 'thread-a')
    const backend = devices.backend(avd.id)
    const frame = await backend.capture(devices.target(avd.id))
    expect(frame.width).toBeGreaterThan(300)
    await backend.perform(devices.target(avd.id), { kind: 'key', key: 'Home' })
    await backend.perform(devices.target(avd.id), { kind: 'click', x: frame.width / 2, y: frame.height / 2 })
    await devices.stop(avd.id)
    expect((await devices.list()).find((device) => device.id === avd.id)?.running).toBe(false)
  }, 400_000)
})
