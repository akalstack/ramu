import { describe, expect, it, vi } from 'vitest'
import type { ComputerAction, ComputerBackend, ComputerGrant } from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { ComputerRefusal } from '../src/computer/session'
import { actionScript, keyCode, pngSize } from '../src/computer/macos'

const grant: ComputerGrant = { target: { id: 'display:main', kind: 'display', name: 'Main' }, observe: true, input: true }

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
    await expect(session.humanInput('tablet', generation, { capturedAt: 1000 }, { kind: 'key', key: 'a' })).rejects.toThrow()
    await session.humanInput('phone', generation, { capturedAt: 1000 }, { kind: 'type', text: 'hi' })
    expect(performed).toEqual([{ kind: 'type', text: 'hi' }])
    time = 7000
    await expect(session.humanInput('phone', generation, { capturedAt: 1000 }, { kind: 'key', key: 'a' })).rejects.toThrow(/stale/)
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
    await expect(session.act('run1', frame.id, { kind: 'click', x: 1, y: 1 })).rejects.toThrow(/may or may not have run/)
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
  it('shares one capture between concurrent viewers and refreshes after the interval', async () => {
    let time = 1000
    const { backend } = fake()
    const service = new ComputerService(backend, () => time)
    const session = service.grant('t', grant)
    const [a, b] = await Promise.all([session.view(), session.view()])
    expect(a.id).toBe(b.id)
    expect(await session.view()).toMatchObject({ id: a.id })
    time += 300
    const next = await session.view()
    expect(next.id).not.toBe(a.id)
    expect(next.sequence).toBeGreaterThan(a.sequence)
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

  it('reads PNG dimensions', () => {
    const header = Buffer.alloc(24)
    header.write('\x89PNG', 0, 'latin1')
    header.writeUInt32BE(300, 16)
    header.writeUInt32BE(150, 20)
    expect(pngSize(header)).toEqual({ width: 300, height: 150 })
    expect(() => pngSize(Buffer.alloc(30))).toThrow()
  })
})
