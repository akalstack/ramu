import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { TestDevices } from '../src/testDevice/testDevices'
import { elementsText, parseSnapshot, type AgentDeviceSession } from '../src/testDevice/agentDevice'
import { parseDoctor, type SimlockHost } from '../src/testDevice/simlock'
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
  release()
  await opening
  expect(await testDevices.waiting()).toEqual([])
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
