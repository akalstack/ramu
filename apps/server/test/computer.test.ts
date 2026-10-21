import { describe, expect, it, vi } from 'vitest'
import type { ComputerAction, ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { ComputerRefusal } from '../src/computer/session'
import { actionScript, keyCode, parseSipsSize } from '../src/computer/macos'

const grant: ComputerGrant = {
  target: { id: 'display:main', kind: 'display', name: 'Main' },
  observe: true,
  input: true,
}

function fake() {
  const performed: ComputerAction[] = []
  const backend: ComputerBackend = {
    status: () => ({ available: true, computer: { id: 'local', name: 'Mac' } }),
    capture: async () => ({ mimeType: 'image/png', data: 'AAAA', width: 200, height: 100, scale: 2 }),
    perform: vi.fn(async (_target, action) => {
      performed.push(action)
    }),
    releaseInput: vi.fn(),
  }
  return { backend, performed }
}

async function ready(now = () => 1000) {
  const { backend, performed } = fake()
  const service = new ComputerService(backend, now)
  const session = service.grant('t1', grant)
  session.open('run1')
  const frame = await session.observe('run1')
  return { service, session, frame, performed, backend }
}

describe('computer session', () => {
  it('requires the latest observation and consumes it on every action', async () => {
    const { session, frame, performed } = await ready()
    await session.act('run1', frame.id, { kind: 'click', x: 10, y: 10 })
    expect(performed).toHaveLength(1)
    await expect(session.act('run1', frame.id, { kind: 'click', x: 10, y: 10 })).rejects.toThrow(/out of date/)
    expect(performed).toHaveLength(1)
  })

  it('refuses points outside the observed screen', async () => {
    const { session, frame, performed } = await ready()
    await expect(session.act('run1', frame.id, { kind: 'click', x: 500, y: 10 })).rejects.toThrow(/outside/)
    expect(performed).toHaveLength(0)
  })

  it('does not act without an input grant and does not observe without an observe grant', async () => {
    const { backend } = fake()
    const service = new ComputerService(backend)
    const watching = service.grant('t', { ...grant, input: false })
    watching.open('r')
    const frame = await watching.observe('r')
    await expect(watching.act('r', frame.id, { kind: 'key', key: 'Enter' })).rejects.toThrow(/Input is not granted/)
    const blind = service.grant('u', { ...grant, observe: false, input: false })
    await expect(blind.view()).rejects.toThrow(/not granted/)
  })

  it('drops queued agent work on takeover and keeps the agent blocked until a fresh observation', async () => {
    const { session, frame, performed } = await ready()
    session.takeControl('phone')
    await expect(session.act('run1', frame.id, { kind: 'key', key: 'Enter' })).rejects.toBeInstanceOf(ComputerRefusal)
    expect(performed).toHaveLength(0)
    session.giveToAgent('phone', 'run1')
    await expect(session.act('run1', frame.id, { kind: 'key', key: 'Enter' })).rejects.toThrow()
    const next = await session.observe('run1')
    await session.act('run1', next.id, { kind: 'key', key: 'Enter' })
    expect(performed).toHaveLength(1)
  })

  it('lets only the human controller send input, and not against a stale frame', async () => {
    let time = 1000
    const { session, performed } = await ready(() => time)
    session.takeControl('phone')
    const { generation } = session.state
    await expect(
      session.humanInput('tablet', generation, { capturedAt: 1000 }, { kind: 'key', key: 'a' }),
    ).rejects.toThrow()
    await session.humanInput('phone', generation, { capturedAt: 1000 }, { kind: 'type', text: 'hi' })
    expect(performed).toEqual([{ kind: 'type', text: 'hi' }])
    time = 7000
    await expect(
      session.humanInput('phone', generation, { capturedAt: 1000 }, { kind: 'key', key: 'a' }),
    ).rejects.toThrow(/stale/)
  })

  it('pauses on controller disconnect without handing control back, releasing held input', async () => {
    const { session, backend } = await ready()
    session.takeControl('phone')
    session.controllerDisconnected('phone')
    expect(session.state.paused).toBe(true)
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'phone' })
    expect(backend.releaseInput).toHaveBeenCalled()
  })

  it('reports an uncertain outcome without replaying the action', async () => {
    const { session, frame, backend } = await ready()
    vi.mocked(backend.perform).mockRejectedValueOnce(new Error('broker lost'))
    await expect(session.act('run1', frame.id, { kind: 'click', x: 1, y: 1 })).rejects.toThrow(
      /may or may not have run/,
    )
    expect(backend.perform).toHaveBeenCalledTimes(1)
  })

  it('stops a run and revokes a grant', async () => {
    const { service, session, frame } = await ready()
    service.endRun('t1', 'run1')
    await expect(session.act('run1', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow()
    service.revoke('t1')
    expect(service.session('t1')).toBeUndefined()
    await expect(session.view()).rejects.toThrow(/closed/)
  })
})

describe('computer frame sharing', () => {
  it('shares one background capture between viewers and returns an unchanged screen without waiting for a new one', async () => {
    const { backend } = fake()
    const service = new ComputerService(backend)
    const session = service.grant('t', grant)
    const [a, b] = await Promise.all([session.view(), session.view()])
    expect(a.id).toBe(b.id)
    expect(a.hash).toBe(b.hash)
    // The screen has not changed, so a viewer that already has this frame gets it back after the wait, not a new image.
    const started = Date.now()
    const again = await session.view(a.hash, 80)
    expect(again.hash).toBe(a.hash)
    expect(Date.now() - started).toBeGreaterThanOrEqual(60)
    service.revoke('t')
  })
})

describe('computer viewers', () => {
  it('lets the owning host in and others only with an explicit grant', () => {
    const service = new ComputerService(fake().backend)
    service.grant('t', grant)
    expect(service.viewerAccess('t', 'local')).toEqual({ observe: true, input: true })
    expect(service.viewerAccess('t', 'phone')).toEqual({ observe: false, input: false })
    service.grantViewer('t', 'phone', false)
    expect(service.viewerAccess('t', 'phone')).toEqual({ observe: true, input: false })
    service.revokeViewer('t', 'phone')
    expect(service.viewerAccess('t', 'phone').observe).toBe(false)
    // A new grant for another target replaces earlier viewer permissions.
    service.grantViewer('t', 'phone', true)
    service.revoke('t')
    expect(service.viewerAccess('t', 'phone').observe).toBe(false)
  })
})

describe('macOS backend helpers', () => {
  it('maps keys and builds scripts from numbers and JSON only', () => {
    expect(keyCode('Enter')).toBe(36)
    expect(keyCode('8')).toBe(28)
    expect(keyCode('Nope')).toBeNull()
    const script = actionScript({ kind: 'type', text: 'a"); evil(' }, 2)
    expect(script).toContain(JSON.stringify('a"); evil('))
    expect(() => actionScript({ kind: 'key', key: 'Nope' }, 1)).toThrow(/Unsupported key/)
    expect(actionScript({ kind: 'click', x: 200, y: 100 }, 2)).toContain('{x:100,y:50}')
  })

  it('reads image dimensions from sips output', () => {
    expect(parseSipsSize('/tmp/x.jpg\n  pixelWidth: 1600\n  pixelHeight: 900')).toEqual({ width: 1600, height: 900 })
    expect(() => parseSipsSize('Error: not an image')).toThrow()
  })
})

describe('open computer use backend', () => {
  const target = { id: 'app:Calculator', kind: 'app' as const, name: 'Calculator' }
  const fakeClient = (fail?: (name: string) => boolean) => {
    const calls: { name: string; arguments: Record<string, unknown> }[] = []
    return {
      calls,
      client: {
        callTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
          calls.push(request)
          if (fail?.(request.name))
            return {
              isError: true,
              content: [{ type: 'text', text: 'type_text requires a focused editable text element.' }],
            }
          return { content: [{ type: 'text', text: 'ok' }] }
        },
        close: async () => {},
      },
    }
  }

  it('maps keys to xdotool syntax and types key by key when the app has no text field', async () => {
    const { ocuKey, OcuBackend, typingKeys } = await import('../src/computer/ocu')
    expect(ocuKey('Enter', ['Meta', 'Shift'])).toBe('super+shift+Return')
    expect(typingKeys('12*8+4')).toEqual(['1', '2', 'KP_Multiply', '8', 'KP_Add', '4'])
    expect(typingKeys('é')).toBeNull()
    const { calls, client } = fakeClient((name) => name === 'type_text')
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => client,
    )
    await backend.perform(target, { kind: 'type', text: '1+2' })
    expect(calls.map((call) => [call.name, call.arguments.key ?? call.arguments.text])).toEqual([
      ['type_text', '1+2'],
      ['press_key', '1'],
      ['press_key', 'KP_Add'],
      ['press_key', '2'],
    ])
  })

  it('names the app on every call and reports a missing install', async () => {
    const { OcuBackend, parseApps } = await import('../src/computer/ocu')
    const { calls, client } = fakeClient()
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => client,
    )
    await backend.perform(target, { kind: 'click', x: 5, y: 6, button: 'right' })
    expect(calls[0]).toEqual({ name: 'click', arguments: { app: 'Calculator', x: 5, y: 6, mouse_button: 'right' } })
    expect(new OcuBackend(() => null).status()).toMatchObject({ available: false, reason: 'not-installed' })
    expect(parseApps('Calculator — com.apple.calculator [running]\nFinder — com.apple.finder')).toEqual([
      'Calculator',
      'Finder',
    ])
  })
})

describe('open computer use install', () => {
  it('installs the pinned release into Ramu’s tools folder and verifies its version', async () => {
    const { installOcu, OCU_VERSION } = await import('../src/computer/ocu')
    const calls: string[][] = []
    const version = await installOcu(async (file, args) => {
      calls.push([file, ...args])
      return args[0] === '--version' ? `${OCU_VERSION}\n` : ''
    }, '/usr/bin/npm')
    expect(version).toBe(OCU_VERSION)
    expect(calls[0]).toEqual(expect.arrayContaining(['install', '--prefix', `open-computer-use@${OCU_VERSION}`]))
    expect(calls[0]).not.toContain('-g')
    await expect(installOcu(async () => '9.9.9\n', '/usr/bin/npm')).rejects.toThrow(/expected/)
    await expect(installOcu(async () => '', null)).rejects.toThrow(/npm/)
  })
})

describe('screen stream', () => {
  const message = (kind: number, payload: Buffer) => {
    const header = Buffer.alloc(5)
    header.writeUInt32BE(payload.length + 1, 0)
    header[4] = kind
    return Buffer.concat([header, payload])
  }

  it('splits the helper output into messages however it is chunked', async () => {
    const { FrameParser } = await import('../src/computer/sck')
    const meta = message(1, Buffer.from(JSON.stringify({ width: 800, height: 450, pointsWidth: 1280 })))
    const jpeg = message(2, Buffer.from([1, 2, 3, 4]))
    const all = Buffer.concat([meta, jpeg, jpeg])
    const parser = new FrameParser()
    const seen = [
      ...parser.push(all.subarray(0, 7)),
      ...parser.push(all.subarray(7, 30)),
      ...parser.push(all.subarray(30)),
    ]
    expect(seen.map((entry) => entry.kind)).toEqual([1, 2, 2])
    expect(() => new FrameParser().push(Buffer.from([0xff, 0xff, 0xff, 0xff, 1]))).toThrow(/malformed/)
  })

  it('returns the latest frame with the scale, and reports a helper that ends', async () => {
    const { EventEmitter } = await import('node:events')
    const { PassThrough } = await import('node:stream')
    const { ScreenStream } = await import('../src/computer/sck')
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill: vi.fn(),
    })
    const stream = new ScreenStream(async () => child as never, 60_000)
    const pending = stream.frame()
    child.stdout.write(message(1, Buffer.from(JSON.stringify({ width: 800, height: 450, pointsWidth: 1600 }))))
    child.stdout.write(message(2, Buffer.from('jpegdata')))
    expect(await pending).toEqual({
      data: Buffer.from('jpegdata').toString('base64'),
      width: 800,
      height: 450,
      scale: 0.5,
    })
    stream.stop()
    const ended = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill: vi.fn(),
    })
    const failing = new ScreenStream(async () => ended as never, 60_000)
    const waiting = failing.frame()
    await new Promise((resolve) => setTimeout(resolve, 5))
    ended.stderr.write('Screen Recording is not allowed for Ramu.')
    await new Promise((resolve) => setTimeout(resolve, 5))
    ended.emit('exit', 2)
    await expect(waiting).rejects.toThrow(/Screen Recording/)
    failing.stop()
  })

  it('falls back to the one-shot capture when the helper cannot start', async () => {
    const { SckDisplayBackend } = await import('../src/computer/sck')
    const inner = {
      ...fake().backend,
      capture: vi.fn(async () => ({ mimeType: 'image/png' as const, data: 'AAAA', width: 10, height: 10, scale: 1 })),
    }
    const backend = new SckDisplayBackend(
      inner,
      async () => {
        throw new Error('no swiftc')
      },
      () => {
        throw new Error('unused')
      },
      'darwin',
    )
    expect((await backend.capture({ id: 'display:main', kind: 'display', name: 'Main' })).data).toBe('AAAA')
    expect(inner.capture).toHaveBeenCalledTimes(1)
    expect(backend.frameInterval({ id: 'display:main', kind: 'display', name: 'Main' })).toBe(250)
  })
})

describe('computer broker', () => {
  const target = { id: 'display:main', kind: 'display' as const, name: 'Main' }

  it('hands a command to the polling owner and returns its result', async () => {
    const { BrokerHub } = await import('../src/computer/broker')
    const hub = new BrokerHub()
    hub.register('laptop', 'Studio')
    const backend = hub.backendFor('laptop')
    expect(backend.status()).toMatchObject({ available: true, computer: { id: 'laptop', name: 'Studio' } })
    const polling = hub.next('laptop', 1000)
    const capture = backend.capture(target)
    const command = await polling
    expect(command).toMatchObject({ kind: 'capture', target })
    hub.result('laptop', command!.id, {
      ok: true,
      value: { mimeType: 'image/png', data: 'AAAA', width: 1, height: 1, scale: 1 },
    })
    await expect(capture).resolves.toMatchObject({ data: 'AAAA' })
  })

  it('queues commands sent before a poll and surfaces an owner error', async () => {
    const { BrokerHub } = await import('../src/computer/broker')
    const hub = new BrokerHub()
    hub.register('laptop', 'Studio')
    const pending = hub.backendFor('laptop').perform(target, { kind: 'key', key: 'a' })
    const command = await hub.next('laptop', 1000)
    expect(command).toMatchObject({ kind: 'perform', action: { kind: 'key', key: 'a' } })
    hub.result('laptop', command!.id, { ok: false, error: 'Accessibility is off' })
    await expect(pending).rejects.toThrow('Accessibility is off')
    expect(await hub.next('laptop', 20)).toBeNull()
  })

  it('refuses an offline or unregistered computer and fails work when the owner stops sharing', async () => {
    const { BrokerHub, BROKER_STALE_MS } = await import('../src/computer/broker')
    let time = 0
    const hub = new BrokerHub(() => time)
    await expect(hub.backendFor('ghost').capture(target)).rejects.toThrow(/offline/)
    hub.register('laptop', 'Studio')
    const pending = hub.backendFor('laptop').capture(target)
    hub.unregister('laptop')
    await expect(pending).rejects.toThrow(/stopped sharing/)
    hub.register('laptop', 'Studio')
    time = BROKER_STALE_MS + 1
    expect(hub.backendFor('laptop').status()).toMatchObject({ available: false, reason: 'offline' })
    await expect(hub.next('other', 10)).rejects.toThrow(/Register/)
  })

  it('grants a thread another computer only when its owner allowed it', async () => {
    const { BrokerHub } = await import('../src/computer/broker')
    const { registerComputerHandlers } = await import('../src/ipc/handlers/computer')
    const hub = new BrokerHub()
    hub.register('laptop', 'Studio')
    const state = new Map<string, unknown>([['computer:enabled', true]])
    const service = new ComputerService(fake().backend)
    const methods = registerComputerHandlers({
      computer: service,
      computerBroker: hub,
      host: { canAdministerIntegrations: () => true, browserDevice: () => 'local', browserGrantEligible: () => true },
      workspace: {
        getTask: () => ({}),
        listTasks: () => [{ id: 't1' }],
        getAppState: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
        setAppState: (key: string, value: unknown) => state.set(key, value),
      },
      agents: { list: () => [] },
    } as never)
    const call = (name: string, ...args: unknown[]) =>
      methods[name]!.run(...(methods[name]!.args.parse(args) as unknown[]))
    await expect(call('computer.grant', 't1', { observe: true, input: true, runtime: 'laptop' })).rejects.toThrow(
      /not allowed/,
    )
    call('computer.allowRuntime', 'laptop', true)
    expect(await call('computer.runtimes')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'laptop', online: true })]),
    )
    const granted = (await call('computer.grant', 't1', { observe: true, input: true, runtime: 'laptop' })) as {
      runtime: { id: string }
    }
    expect(granted.runtime).toEqual({ id: 'laptop', name: 'Studio' })
    call('computer.allowRuntime', 'laptop', false)
    expect(service.session('t1')).toBeUndefined()
    expect(hub.list()).toEqual([])
  })
})

describe('h264 packetizing', () => {
  it('splits Annex-B into NAL units and fragments large ones with the marker on the last packet', async () => {
    const { splitNalus, packetizeH264 } = await import('../src/computer/video')
    const sps = Buffer.from([0x67, 1, 2, 3])
    const idr = Buffer.concat([Buffer.from([0x65]), Buffer.alloc(3000, 7)])
    const stream = Buffer.concat([Buffer.from([0, 0, 0, 1]), sps, Buffer.from([0, 0, 1]), idr])
    const nalus = splitNalus(stream)
    expect(nalus).toHaveLength(2)
    expect(nalus[0]).toEqual(sps)
    expect(nalus[1]).toEqual(idr)
    const state = { sequence: 65534, ssrc: 1234, payloadType: 102 }
    const packets = packetizeH264(nalus, 9000, state)
    expect(packets[0]!.payload).toEqual(sps)
    const fragments = packets.slice(1)
    expect(fragments.length).toBeGreaterThan(2)
    expect(fragments[0]!.payload[0]! & 0x1f).toBe(28)
    expect(fragments[0]!.payload[1]! & 0x80).toBe(0x80)
    expect(fragments.at(-1)!.payload[1]! & 0x40).toBe(0x40)
    expect(packets.map((packet) => packet.header.marker)).toEqual([...packets.slice(0, -1).map(() => false), true])
    expect(packets.map((packet) => packet.header.sequenceNumber).slice(0, 3)).toEqual([65534, 65535, 0])
    // Reassembling the fragments restores the original NAL unit.
    const rebuilt = Buffer.concat([
      Buffer.from([(fragments[0]!.payload[0]! & 0xe0) | (fragments[0]!.payload[1]! & 0x1f)]),
      ...fragments.map((packet) => packet.payload.subarray(2)),
    ])
    expect(rebuilt).toEqual(idr)
  })

  it('parses a key frame message from the helper', async () => {
    const { FrameParser } = await import('../src/computer/sck')
    const body = Buffer.concat([Buffer.from([1]), Buffer.from([0, 0, 0, 1, 0x65, 9])])
    const header = Buffer.alloc(5)
    header.writeUInt32BE(body.length + 1, 0)
    header[4] = 3
    expect(new FrameParser().push(Buffer.concat([header, body]))).toEqual([
      { kind: 3, key: true, annexB: Buffer.from([0, 0, 0, 1, 0x65, 9]) },
    ])
  })
})

describe('locked use', () => {
  it('reads Open Computer Use’s status and starts the installer without waiting for it', async () => {
    const { LockedUse, parseLockedUse } = await import('../src/computer/lockedUse')
    const status = JSON.stringify({
      enabled: false,
      available: false,
      stage: 'not-installed',
      clientApproved: false,
      session: { state: 'unlocked' },
      blockers: ['Run ocu locked-use enable'],
    })
    expect(parseLockedUse(status)).toMatchObject({
      installed: true,
      enabled: false,
      session: 'unlocked',
      blockers: ['Run ocu locked-use enable'],
    })
    const started: string[][] = []
    const lock = new LockedUse(
      () => '/bin/ocu',
      async () => status,
      (file, args) => started.push([file, ...args]),
    )
    expect((await lock.enable()).stage).toBe('not-installed')
    expect(started).toEqual([['/bin/ocu', 'locked-use', 'enable']])
    expect(await new LockedUse(() => null).status()).toMatchObject({ installed: false })
    await expect(new LockedUse(() => null).enable()).rejects.toThrow(/Install Open Computer Use/)
    const broken = new LockedUse(
      () => '/bin/ocu',
      async () => {
        throw new Error('boom')
      },
    )
    expect(await broken.status()).toMatchObject({ installed: true, available: false, blockers: ['boom'] })
  })
})

describe('locked screen through a session', () => {
  it('tells the person nothing ran when the screen is locked', async () => {
    const { ComputerNotRun } = await import('@ramu/shared/computerBridge')
    const { backend } = fake()
    vi.mocked(backend.perform).mockRejectedValueOnce(new ComputerNotRun('The computer is locked.'))
    const service = new ComputerService(backend)
    const session = service.grant('t', grant)
    session.open('run1')
    const frame = await session.observe('run1')
    await expect(session.act('run1', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/^The computer is locked\.$/)
  })
})

describe('locked screen', () => {
  it('reads the lock flag from the registry output', async () => {
    const { parseScreenLocked, MacosComputerBackend, LOCKED_MESSAGE } = await import('../src/computer/macos')
    expect(parseScreenLocked('<key>CGSSessionScreenIsLocked</key>\n\t\t\t<true/>')).toBe(true)
    expect(parseScreenLocked('<key>kCGSSessionOnConsoleKey</key><true/>')).toBe(false)
    const locked = new MacosComputerBackend(async () => '<key>CGSSessionScreenIsLocked</key><true/>', 'darwin')
    await expect(locked.capture({ id: 'display:main', kind: 'display', name: 'Main' })).rejects.toThrow(LOCKED_MESSAGE)
    await expect(
      locked.perform({ id: 'display:main', kind: 'display', name: 'Main' }, { kind: 'key', key: 'a' }),
    ).rejects.toThrow(/locked/)
    expect(locked.status()).toMatchObject({ available: false, reason: 'locked' })
  })
})

describe('app scrolling', () => {
  const target = { id: 'app:Notes', kind: 'app' as const, name: 'Notes' }
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24)
    bytes[0] = 0x89
    bytes.write('PNG', 1, 'latin1')
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    return bytes.toString('base64')
  }
  const state =
    '0 standard window Notes\n\t1 split group\n\t\t4 scroll area ID: Body, Secondary Actions: Scroll Up\n\t\t9 scroll area ID: Side'

  it('finds scroll areas in the app tree', async () => {
    const { scrollAreas } = await import('../src/computer/ocu')
    expect(scrollAreas(state)).toEqual(['4', '9'])
    expect(scrollAreas('1 button Delete')).toEqual([])
  })

  it('scrolls the area in either direction and falls back to page keys for vertical scrolls', async () => {
    const { OcuBackend } = await import('../src/computer/ocu')
    const calls: { name: string; arguments: Record<string, unknown> }[] = []
    const client = {
      callTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
        calls.push(request)
        if (request.name === 'get_app_state')
          return {
            content: [
              { type: 'text', text: state },
              {
                type: 'image',
                data: png(5, 5),
                mimeType: 'image/png',
              },
            ],
          }
        if (request.name === 'scroll' && request.arguments.direction === 'up')
          return { isError: true, content: [{ type: 'text', text: 'no' }] }
        return { content: [{ type: 'text', text: 'ok' }] }
      },
      close: async () => {},
    }
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => client,
    )
    await backend.capture(target)
    await backend.perform(target, { kind: 'scroll', x: 1, y: 1, dx: 0, dy: 600 })
    await backend.perform(target, { kind: 'scroll', x: 1, y: 1, dx: 1200, dy: 0 })
    await backend.perform(target, { kind: 'scroll', x: 1, y: 1, dx: 0, dy: -300 })
    expect(
      calls
        .filter((call) => call.name !== 'get_app_state')
        .map((call) => [
          call.name,
          call.arguments.element_index ?? call.arguments.key,
          call.arguments.direction,
          call.arguments.pages,
        ]),
    ).toEqual([
      ['scroll', '4', 'down', 1],
      ['scroll', '4', 'right', 2],
      ['scroll', '4', 'up', 0.5],
      ['press_key', 'Page_Up', undefined, undefined],
    ])
  })
})
