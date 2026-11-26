import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { processFor, TestDevices } from '../src/testDevice/testDevices'
import { elementsText, parseSnapshot, type AgentDeviceSession } from '../src/testDevice/agentDevice'
import {
  chosenConfig,
  parseDoctor,
  simlockEnvironment,
  simlockToolDir,
  type SimlockHost,
} from '../src/testDevice/simlock'
import { avccUnits, FrameReader, parameterSets } from '../src/testDevice/deviceVideo'

vi.mock('../src/testDevice/simlock', async (original) => ({
  ...(await original<typeof import('../src/testDevice/simlock')>()),
  simlockInstalled: () => true,
}))

it('reads agent-device elements and lists them with refs and centres in screenshot pixels', () => {
  const elements = parseSnapshot(
    JSON.stringify({
      success: true,
      data: {
        nodes: [
          {
            ref: 'e1',
            kind: 'other',
            label: 'Settings',
            rect: { x: 0, y: 0, width: 402, height: 874 },
            depth: 0,
            hittable: false,
          },
          { ref: 'e7', kind: 'cell', label: 'General', rect: { x: 16, y: 300, width: 370, height: 52 }, depth: 2 },
          { ref: 'e9', kind: 'other', rect: { x: 0, y: 0, width: 1, height: 1 }, depth: 2, hittable: false },
          {
            ref: 'e16',
            kind: 'search',
            label: 'Search',
            editable: true,
            rect: { x: 10, y: 800, width: 380, height: 40 },
            depth: 1,
          },
        ],
      },
    }),
  )
  expect(elementsText(elements, 3)).toBe(
    [
      '@e1 other "Settings" @603,1311',
      '    @e7 cell "General" @603,978',
      '  @e16 search "Search" (editable) @600,2460',
    ].join('\n'),
  )
})

it('turns simlock doctor findings into checklist items per platform', () => {
  expect(
    parseDoctor(
      'Missing [android] android-jdk: sdkmanager cannot run\n' +
        JSON.stringify({
          findings: [
            {
              kind: 'prerequisite-missing',
              platform: 'android',
              prerequisite: 'android-jdk',
              message: 'No Java.',
              remedy: 'Install a JDK.',
            },
          ],
        }),
    ),
  ).toEqual([{ platform: 'android', item: 'android-jdk', message: 'No Java.', remedy: 'Install a JDK.' }])
})

let host: SimlockHost
let session: AgentDeviceSession
let requests: { path: string; init?: RequestInit; holder?: string }[]

beforeEach(() => {
  requests = []
  host = {
    ready: vi.fn(async () => {}),
    createToken: vi.fn(async () => ({ id: 'tok_a', secret: 'secret-a' })),
    revokeToken: vi.fn(async () => {}),
    doctor: vi.fn(async () => []),
    catalog: vi.fn(async () => ({
      platforms: [
        {
          platform: 'ios' as const,
          models: ['iPhone 18 Pro', 'iPhone 17', 'iPhone Duo'],
          runtimes: ['27.0'],
          modelRuntimes: { 'iPhone 18 Pro': ['27.0'], 'iPhone 17': ['27.0'], 'iPhone Duo': [] },
          classDefaults: { phone: 'iPhone 17' },
        },
      ],
    })),
    status: vi.fn(async () => ({ devices: [], leases: [], waiting: [], capacity: {} })),
    request: vi.fn(async (path: string, init?: RequestInit, holder?: string) => {
      requests.push({ path, init, holder })
      if (path === '/v1/leases')
        return new Response(JSON.stringify({ leases: [{ id: 'lease-1', deviceId: 'dev-1', ownerId: 'tok_a' }] }))
      return new Response('{}')
    }),
  } as unknown as SimlockHost
  session = {
    name: 'ramu-x',
    connect: vi.fn(async () => ({})),
    open: vi.fn(async () => ({ device_udid: 'UDID-1', lease: { device: { model: 'iPhone 17', osVersion: '27.0' } } })),
    snapshot: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    command: vi.fn(async () => ({})),
  } as unknown as AgentDeviceSession
})

const devices = (patch: Partial<ConstructorParameters<typeof TestDevices>[1]> = {}) =>
  new TestDevices(() => true, { host, newSession: () => session, platform: 'darwin', arch: 'arm64', ...patch })

it('gives a thread its own device, found by the lease its token holds, on the platform default phone', async () => {
  const testDevices = devices()
  expect((await testDevices.status()).defaults.ios).toBe('iPhone 17')
  expect((await testDevices.status()).models.ios.map((model) => model.name)).toEqual(['iPhone 18 Pro', 'iPhone 17'])
  const opened = await testDevices.open('thread-a', { platform: 'ios' })
  expect(opened).toEqual({ name: 'iPhone 17 · iOS 27.0', platform: 'ios' })
  expect(session.open).toHaveBeenCalledWith({ platform: 'ios', model: 'iPhone 17' })
  expect((await testDevices.status()).inUse).toEqual([
    expect.objectContaining({ taskId: 'thread-a', name: 'iPhone 17 · iOS 27.0' }),
  ])
  await testDevices.rotate('thread-a', 'landscape-left')
  const rotate = requests.find((entry) => entry.path === '/v1/leases/lease-1/rotate')!
  expect(rotate.holder).toBe('secret-a')
  expect(JSON.parse(String(rotate.init?.body))).toEqual({ orientation: 'landscape_left' })
  await testDevices.releaseThread('thread-a')
  expect(session.close).toHaveBeenCalled()
  expect(host.revokeToken).toHaveBeenCalledWith('tok_a')
  expect((await testDevices.status()).inUse).toEqual([])
})

it('refuses what this host cannot run, before taking anything', async () => {
  const linux = devices({ platform: 'linux', arch: 'x64' })
  await expect(linux.open('thread-a', { platform: 'ios' })).rejects.toThrow(/only on a Mac/)
  expect((await linux.readiness()).ios.unsupported).toMatch(/only on a Mac/)
  expect(host.createToken).not.toHaveBeenCalled()
  await expect(devices({ platform: 'win32' }).open('thread-a', { platform: 'android' })).rejects.toThrow(
    /macOS and Linux/,
  )
})

it('says a platform needs a system to run when its tools pass but no model has one', async () => {
  vi.mocked(host.catalog).mockResolvedValue({
    platforms: [{ platform: 'ios', models: ['iPhone 17'], runtimes: [], modelRuntimes: { 'iPhone 17': [] } }],
  })
  vi.mocked(host.doctor).mockResolvedValue([
    { platform: 'android', item: 'android-cmdline-tools', message: 'No sdkmanager.', remedy: 'Install them.' },
  ])
  const { ios, android } = await devices().readiness()
  expect(ios).toEqual({ ready: false, missing: [expect.objectContaining({ item: 'ios-runtime' })] })
  expect(android.missing.map((entry) => entry.item)).toEqual(['android-cmdline-tools'])

  vi.mocked(host.catalog).mockRejectedValue(new Error('Simlock is restarting'))
  expect((await devices().readiness()).ios.ready).toBe(true)
})

it('gives back what it took when the device never arrives, and keeps app files inside the workspace', async () => {
  vi.mocked(session.open).mockRejectedValueOnce(new Error('No capacity'))
  const testDevices = devices()
  await expect(testDevices.open('thread-a', { platform: 'ios' })).rejects.toThrow('No capacity')
  expect(session.close).toHaveBeenCalled()
  expect(host.revokeToken).toHaveBeenCalledWith('tok_a')
  await testDevices.open('thread-a', { platform: 'ios' })
  const workspace = mkdtempSync(join(tmpdir(), 'ramu-ws-'))
  await expect(testDevices.install('thread-a', workspace, '/etc/hosts')).rejects.toThrow(/relative/)
  await expect(testDevices.install('thread-a', workspace, '../../etc/hosts')).rejects.toThrow()
})

it('shows a waiting thread its place in Simlock’s queue', async () => {
  let release: () => void = () => {}
  vi.mocked(session.open).mockImplementationOnce(
    () => new Promise((done) => (release = () => done({ device_udid: 'UDID-1' }))),
  )
  vi.mocked(host.status).mockResolvedValue({
    devices: [],
    leases: [],
    waiting: [{ requesterId: 'x', spec: { platform: 'ios' }, createdAt: 1, stage: 'queued', queuePosition: 2 }],
    capacity: {},
  } as never)
  const testDevices = devices()
  const opening = testDevices.open('thread-a', { platform: 'ios' })
  await vi.waitFor(() => expect(session.open).toHaveBeenCalled())
  expect(await testDevices.waiting()).toEqual([{ taskId: 'thread-a', platform: 'ios', position: 2 }])
  expect(await testDevices.placeOf('thread-a')).toEqual({ state: 'waiting', position: 2 })
  release()
  await opening
  expect(await testDevices.waiting()).toEqual([])
  expect(await testDevices.placeOf('thread-a')).toEqual({ state: 'held', name: 'iPhone 17' })
})

it('turns Simlock’s stream frames into access units a WebRTC viewer can start from', () => {
  const sps = Buffer.from([0x67, 0x64, 0x00, 0x1f, 0xac])
  const pps = Buffer.from([0x68, 0xee, 0x3c])
  const avcc = Buffer.concat([
    Buffer.from([1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, sps.length]),
    sps,
    Buffer.from([1, 0, pps.length]),
    pps,
  ])
  expect(parameterSets(avcc)).toEqual([sps, pps])
  const slice = Buffer.from([0x65, 1, 2, 3])
  const frame = (tag: number, payload: Buffer) => {
    const header = Buffer.alloc(5)
    header.writeUInt32BE(payload.length + 1)
    header[4] = tag
    return Buffer.concat([header, payload])
  }
  const lengthPrefixed = Buffer.concat([Buffer.from([0, 0, 0, slice.length]), slice])
  const stream = Buffer.concat([
    frame(5, Buffer.from('{"width":734,"height":1600}')),
    frame(1, avcc),
    frame(2, lengthPrefixed),
  ])
  const reader = new FrameReader()
  // Frames split across chunks still come out whole.
  const frames = [...reader.push(stream.subarray(0, 7)), ...reader.push(stream.subarray(7))]
  expect(frames.map((entry) => entry.tag)).toEqual([5, 1, 2])
  expect(avccUnits(frames[2]!.payload)).toEqual([slice])
})

it('shows a thread it is waiting only when its device does not come at once', async () => {
  vi.useFakeTimers()
  try {
    const waiting = vi.fn()
    let release: () => void = () => {}
    vi.mocked(session.open).mockImplementationOnce(
      () => new Promise((done) => (release = () => done({ device_udid: 'UDID-1' }))),
    )
    const opening = devices({ waiting }).open('thread-a', { platform: 'ios' })
    await vi.advanceTimersByTimeAsync(3100)
    expect(waiting).toHaveBeenCalledWith('thread-a', 'ios')
    release()
    await opening
    // A device that comes at once shows no waiting card.
    await devices({ waiting }).open('thread-b', { platform: 'ios' })
    await vi.advanceTimersByTimeAsync(3100)
    expect(waiting).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('turns the person’s choices into Simlock’s settings, putting Simlock’s own cap back for Automatic', () => {
  expect(chosenConfig({ keepWarm: false, maxRunning: null, slim: false })).toEqual({
    'warmPool.enabled': 'false',
    'capacity.config.limits.maxRunning': '7',
    'ios.defaultMode': 'full',
  })
  expect(chosenConfig({ keepWarm: true, maxRunning: 2, slim: true })).toEqual({
    'warmPool.enabled': 'true',
    'capacity.config.limits.maxRunning': '2',
    'ios.defaultMode': 'slim',
  })
})

it('finds a device’s own process for Resources: launchd_sim by UDID, qemu by its port', () => {
  const table = [
    '  101 /usr/sbin/notifyd',
    '  202 launchd_sim /Users/me/.ramu/simlock/devices/ios/UDID-1/data/var/run/launchd_bootstrap.plist',
    '  303 /sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd simlock_x -port 5588 -no-snapshot-save',
    '  404 /sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd other -port 5554',
  ].join('\n')
  expect(processFor(table, 'ios', 'UDID-1')).toBe(202)
  expect(processFor(table, 'android', 'emulator-5588')).toBe(303)
  expect(processFor(table, 'ios', 'UDID-2')).toBeNull()
})

it('gives back devices an earlier run of Ramu held, since Simlock keeps renewing them after Ramu stops', async () => {
  const calls: string[][] = []
  const exec = vi.fn(async (_file: string, args: string[]) => {
    const command = args.slice(1)
    calls.push(command)
    if (command[0] === 'config') return command[1] === 'get' ? 'unchanged' : ''
    if (command[0] === 'daemon') return 'Daemon running'
    if (command.join(' ') === 'token list')
      return JSON.stringify({
        tokens: [
          { id: 'tok_old', role: 'agent', label: 'ramu thread-a' },
          { id: 'tok_mine', role: 'agent', label: 'agent-device on this Mac' },
        ],
      })
    if (command[0] === 'token' && command[1] === 'create')
      return JSON.stringify({ secret: 'operator-secret', token: { id: 'tok_op' } })
    return ''
  })
  const http = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          leases: [
            { id: 'lease-old', ownerId: 'tok_old' },
            { id: 'lease-other', ownerId: 'tok_someone' },
          ],
        }),
      ),
  )
  const real = await vi.importActual<typeof import('../src/testDevice/simlock')>('../src/testDevice/simlock')
  // The real host checks Simlock is installed, so give it an installed copy apart from this machine's own.
  const tools = mkdtempSync(join(tmpdir(), 'ramu-tools-'))
  vi.stubEnv('RAMU_TOOLS_DIR', tools)
  for (const file of ['node_modules/simlock/dist/cli/main.js', 'node_modules/.bin/agent-device']) {
    const path = join(real.simlockToolDir(), file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '')
  }
  try {
    await new real.SimlockHost(() => ({}), exec, http as unknown as typeof fetch).ready()
  } finally {
    vi.unstubAllEnvs()
    rmSync(tools, { recursive: true, force: true })
  }
  expect(calls).toContainEqual(['token', 'revoke', 'tok_old'])
  expect(calls).not.toContainEqual(['token', 'revoke', 'tok_mine'])
  expect(calls).toContainEqual(['release', 'lease-old'])
  expect(calls).not.toContainEqual(['release', 'lease-other'])
})

it('points the Simlock node shim at the Ramu running now when the one it was installed with moved', () => {
  const tools = mkdtempSync(join(tmpdir(), 'ramu-tools-'))
  vi.stubEnv('RAMU_TOOLS_DIR', tools)
  try {
    const shim = join(simlockToolDir(), 'bin/node')
    mkdirSync(join(simlockToolDir(), 'bin'), { recursive: true })
    writeFileSync(shim, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/gone/checkout/Electron" "$@"\n')
    simlockEnvironment()
    expect(readFileSync(shim, 'utf8')).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`)
  } finally {
    vi.unstubAllEnvs()
    rmSync(tools, { recursive: true, force: true })
  }
})
