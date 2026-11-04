import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { ComputerAction, ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { ComputerRefusal } from '../src/computer/session'
import { actionScript, focusFromRole, keyCode, parseSipsSize } from '../src/computer/macos'

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
  it('lets one thread act on the main display at a time, while different apps run side by side', async () => {
    let clock = 1000
    const { backend, performed } = fake()
    const service = new ComputerService(backend, () => clock)
    const start = async (thread: string, target = grant.target) => {
      const session = service.grant(thread, { ...grant, target })
      session.open(`${thread}-run`)
      return { session, frame: await session.observe(`${thread}-run`) }
    }
    const first = await start('t1')
    const second = await start('t2')
    await first.session.act('t1-run', first.frame.id, { kind: 'click', x: 1, y: 1 })
    // Watching stays shared; acting is refused while the first thread has the display.
    const again = await second.session.observe('t2-run')
    await expect(second.session.act('t2-run', again.id, { kind: 'click', x: 1, y: 1 })).rejects.toThrow(
      /Another thread is controlling the main display/,
    )
    const notes = await start('t3', { id: 'app:Notes', kind: 'app', name: 'Notes' })
    const mail = await start('t4', { id: 'app:Mail', kind: 'app', name: 'Mail' })
    await notes.session.act('t3-run', notes.frame.id, { kind: 'key', key: 'a' })
    await mail.session.act('t4-run', mail.frame.id, { kind: 'key', key: 'b' })
    const sameApp = await start('t5', { id: 'app:Notes', kind: 'app', name: 'Notes' })
    await expect(sameApp.session.act('t5-run', sameApp.frame.id, { kind: 'key', key: 'c' })).rejects.toThrow(
      /Another thread is using Notes/,
    )
    // The first thread's run ends: the display is free at once. An idle claim also lapses.
    service.endRun('t1', 't1-run')
    const freed = await second.session.observe('t2-run')
    await second.session.act('t2-run', freed.id, { kind: 'click', x: 2, y: 2 })
    clock += 60_000
    const later = await sameApp.session.observe('t5-run')
    await sameApp.session.act('t5-run', later.id, { kind: 'key', key: 'd' })
    expect(performed).toHaveLength(5)
  })

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

describe('computer frame waiting', () => {
  const changing = () => {
    let data = 'AAAA'
    const { backend } = fake()
    backend.capture = async () => ({ mimeType: 'image/png', data, width: 200, height: 100, scale: 2 })
    backend.frameInterval = () => 20
    return { backend, change: (next: string) => (data = next) }
  }

  it('returns a waiting viewer as soon as the screen changes, long before the wait ends', async () => {
    const { backend, change } = changing()
    const service = new ComputerService(backend)
    const session = service.grant('t', grant)
    const first = await session.view()
    setTimeout(() => change('BBBB'), 60)
    const started = Date.now()
    const next = await session.view(first.hash, 5000)
    expect(next.hash).not.toBe(first.hash)
    expect(next.capture.data).toBe('BBBB')
    expect(Date.now() - started).toBeLessThan(2000)
    service.revoke('t')
  })

  it('ends a waiting viewer when its grant is revoked instead of leaving it hanging', async () => {
    const { backend } = changing()
    const service = new ComputerService(backend)
    const session = service.grant('t', grant)
    const first = await session.view()
    const waiting = session.view(first.hash, 5000)
    setTimeout(() => service.revoke('t'), 60)
    await expect(waiting).rejects.toThrow(/closed/)
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

  // Runs the real script with posting replaced by reading each key event's text back; nothing reaches the screen.
  it.runIf(process.platform === 'darwin')('types the characters given, not key code 0’s "a"', () => {
    const script = actionScript({ kind: 'type', text: 'hé!' }, 1).replace(
      /\$\.CGEventPost\(\$\.kCGHIDEventTap, e\);/g,
      'if(d===1){var l=Ref(),b=Ref();$.CGEventKeyboardGetUnicodeString(e,4,l,b);out.push(b[0])}',
    )
    const typed = execFileSync('osascript', ['-l', 'JavaScript', '-e', `var out=[];${script};out.join(',')`])
    expect(typed.toString().trim()).toBe('104,233,33')
  })

  it('asks for the matching phone keyboard only for a focused text field', () => {
    expect(focusFromRole('AXTextField|')).toEqual({ editable: true, kind: 'text' })
    expect(focusFromRole('AXTextField|AXSecureTextField')).toEqual({ editable: true, kind: 'password' })
    expect(focusFromRole('AXTextField|AXSearchField')).toEqual({ editable: true, kind: 'search' })
    expect(focusFromRole('AXTextArea|')).toEqual({ editable: true, kind: 'multiline' })
    for (const other of ['AXButton|', 'AXWebArea|', '', 'garbage'])
      expect(focusFromRole(other)).toEqual({ editable: false })
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

  it.runIf(process.platform === 'darwin')('names the app on every call and reports a missing install', async () => {
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

describe('open computer use connection', () => {
  const target = { id: 'app:Chrome', kind: 'app' as const, name: 'Chrome' }
  it('starts a new helper when the old one has gone, and asks a read again but never repeats input', async () => {
    const { OcuBackend } = await import('../src/computer/ocu')
    const clients: { onclose?: () => void; calls: string[] }[] = []
    let failNext = false
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => {
        const client = {
          calls: [] as string[],
          onclose: undefined as (() => void) | undefined,
          callTool: async ({ name }: { name: string }) => {
            client.calls.push(name)
            if (failNext) {
              failNext = false
              throw new Error('MCP error -32000: Connection closed')
            }
            return { content: [{ type: 'text', text: 'Chrome — com.google.Chrome [running]' }] }
          },
          close: async () => {},
        }
        clients.push(client)
        return client
      },
    )
    expect(await backend.apps()).toEqual(['Chrome'])
    // The helper exits between calls: the next one goes to a new helper without failing first.
    clients[0]!.onclose?.()
    expect(await backend.apps()).toEqual(['Chrome'])
    expect(clients).toHaveLength(2)
    // A read that hits a closed connection is asked again once.
    failNext = true
    expect(await backend.apps()).toEqual(['Chrome'])
    expect(clients).toHaveLength(3)
    // Input is not: it may already have run.
    failNext = true
    await expect(backend.perform(target, { kind: 'click', x: 1, y: 1 })).rejects.toThrow(/Connection closed/)
    expect(clients.flatMap((client) => client.calls).filter((name) => name === 'click')).toHaveLength(1)
  })
})

describe('open computer use refusals', () => {
  it('says why working behind the lock screen is refused when another app holds it', async () => {
    const { explained } = await import('../src/computer/ocu')
    expect(explained('Locked Use belongs to another connection; GUI access is unavailable.')).toMatch(/Another app/)
    expect(explained('MCP error -32000: Locked Use is unavailable. Enable and validate it.')).toMatch(/Unlock this Mac/)
    expect(explained('Chrome has no window')).toBe('Chrome has no window')
  })
})

describe('open computer use helper', () => {
  it('keeps a live helper through a refusal, so its locked-screen session is not ended', async () => {
    const { OcuBackend } = await import('../src/computer/ocu')
    let started = 0
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => {
        started++
        return {
          callTool: async () => {
            throw new Error('MCP error -32000: Chrome is not running')
          },
          close: async () => {},
        }
      },
    )
    await expect(backend.apps()).rejects.toThrow(/not running/)
    await expect(backend.apps()).rejects.toThrow(/not running/)
    expect(started).toBe(1)
  })
})

describe('open computer use frames', () => {
  const target = { id: 'app:Chrome', kind: 'app' as const, name: 'Chrome' }
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  it('sends a viewer a light snapshot and hands back the picture an action returns', async () => {
    const { OcuBackend } = await import('../src/computer/ocu')
    const calls: { name: string; arguments: Record<string, unknown> }[] = []
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async () => ({
        callTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
          calls.push(request)
          return {
            content: [
              { type: 'text', text: 'tree' },
              { type: 'image', data: png, mimeType: 'image/png' },
            ],
          }
        },
        close: async () => {},
      }),
    )
    await backend.capture(target, { forViewer: true })
    await backend.capture(target)
    expect(calls[0]!.arguments).toMatchObject({ app: 'Chrome', max_tree_nodes: expect.any(Number) })
    // An agent's observation keeps the whole tree.
    expect(calls[1]!.arguments).toEqual({ app: 'Chrome' })
    expect(await backend.perform(target, { kind: 'click', x: 1, y: 1 })).toMatchObject({
      width: 1,
      height: 1,
      data: png,
    })
  })
})

describe('open computer use install', () => {
  it.runIf(process.platform === 'darwin')(
    'installs the pinned release into Ramu’s tools folder and verifies its version',
    async () => {
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
    },
  )
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
  it.runIf(process.platform === 'darwin')(
    'reads Open Computer Use’s status and starts the installer without waiting for it',
    async () => {
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
      let finish: (result: { code: number | null; output: string }) => void = () => {}
      const lock = new LockedUse(
        () => '/bin/ocu',
        async () => status,
        (file, args, done) => {
          started.push([file, ...args])
          finish = done
        },
      )
      expect(await lock.enable()).toMatchObject({ stage: 'not-installed', installer: { running: true } })
      expect(started).toEqual([['/bin/ocu', 'locked-use', 'enable']])
      await expect(lock.enable()).rejects.toThrow(/already open/)
      // A cancelled administrator prompt ends the installer; its last words say so.
      finish({
        code: 1,
        output: 'Requesting authorization…\nLocked Use administrator installation did not complete.\n',
      })
      expect((await lock.status()).installer).toEqual({
        running: false,
        error: 'Locked Use administrator installation did not complete.',
      })
      expect(await new LockedUse(() => null).status()).toMatchObject({ installed: false })
      await expect(new LockedUse(() => null).enable()).rejects.toThrow(/Install Open Computer Use/)
      const broken = new LockedUse(
        () => '/bin/ocu',
        async () => {
          throw new Error('boom')
        },
      )
      expect(await broken.status()).toMatchObject({ installed: true, available: false, blockers: ['boom'] })
    },
  )
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

describe('accessibility text for the agent', () => {
  const target = { id: 'app:Calculator', kind: 'app' as const, name: 'Calculator' }
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24)
    bytes[0] = 0x89
    bytes.write('PNG', 1, 'latin1')
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    return bytes.toString('base64')
  }
  const tree = '1 window Calculator\n2 button 7\n3 button 8'
  const backendWith = async (text: string) => {
    const { OcuBackend } = await import('../src/computer/ocu')
    const client = {
      callTool: async () => ({
        content: [
          { type: 'text', text },
          { type: 'image', data: png(5, 5), mimeType: 'image/png' },
        ],
      }),
      close: async () => {},
    }
    return new OcuBackend(
      () => '/bin/ocu',
      async () => client,
    )
  }

  it('carries the app tree on a capture, bounded, and omits it when the app returns none', async () => {
    const { MAX_COMPUTER_TREE_TEXT } = await import('@ramu/shared/computerBridge')
    expect((await (await backendWith(tree)).capture(target)).text).toBe(tree)
    expect((await (await backendWith('x'.repeat(MAX_COMPUTER_TREE_TEXT + 500))).capture(target)).text).toHaveLength(
      MAX_COMPUTER_TREE_TEXT,
    )
    expect(await (await backendWith('   ')).capture(target)).not.toHaveProperty('text')
  })

  it('reaches the agent through observe', async () => {
    const service = new ComputerService(await backendWith(tree))
    const session = service.grant('t', { target, observe: true, input: true })
    session.open('run')
    expect((await session.observe('run')).capture.text).toBe(tree)
    service.revoke('t')
  })
})

describe('real pointer for drags', () => {
  it('starts the helper with the pointer flag only when allowed, and restarts it when the setting changes', async () => {
    const { OcuBackend } = await import('../src/computer/ocu')
    const starts: boolean[] = []
    let closed = 0
    let allowed = false
    const backend = new OcuBackend(
      () => '/bin/ocu',
      async (_file, pointer) => {
        starts.push(pointer)
        return { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }), close: async () => void closed++ }
      },
      () => allowed,
    )
    const app = { id: 'app:Notes', kind: 'app' as const, name: 'Notes' }
    await backend.perform(app, { kind: 'drag', fromX: 1, fromY: 1, toX: 9, toY: 9 })
    await backend.perform(app, { kind: 'drag', fromX: 1, fromY: 1, toX: 9, toY: 9 })
    expect(starts).toEqual([false])
    allowed = true
    await backend.perform(app, { kind: 'drag', fromX: 1, fromY: 1, toX: 9, toY: 9 })
    expect(starts).toEqual([false, true])
    expect(closed).toBe(1)
  })
})
