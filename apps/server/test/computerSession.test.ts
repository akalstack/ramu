import { describe, expect, it } from 'vitest'
import type {
  ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerGrant,
  ComputerTarget,
} from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { ComputerRefusal } from '../src/computer/session'

const target: ComputerTarget = { id: 'calc', kind: 'app', name: 'Calculator' }
const grant = (patch: Partial<ComputerGrant> = {}): ComputerGrant => ({ target, observe: true, input: true, ...patch })

class FakeBackend implements ComputerBackend {
  performed: ComputerAction[] = []
  released = 0
  failNext = false
  hold: Promise<void> | null = null
  status() {
    return { available: true as const, computer: { id: 'a', name: 'Laptop' } }
  }
  async capture(): Promise<ComputerCapture> {
    return { mimeType: 'image/jpeg', data: 'AA==', width: 400, height: 300, scale: 2 }
  }
  async perform(_target: ComputerTarget, action: ComputerAction): Promise<ComputerCapture | void> {
    await this.hold
    if (this.failNext) {
      this.failNext = false
      throw new Error('driver lost')
    }
    this.performed.push(action)
  }
  releaseInput() {
    this.released++
  }
}

const setup = (patch?: Partial<ComputerGrant>) => {
  const backend = new FakeBackend()
  let clock = 1000
  const service = new ComputerService(backend, () => clock)
  const session = service.grant('thread', grant(patch))
  return { backend, service, session, tick: (ms: number) => (clock += ms) }
}

describe('computer session', () => {
  it('needs an open session, an observation and the latest observation id for each action', async () => {
    const { session, backend } = setup()
    await expect(session.observe('run')).rejects.toBeInstanceOf(ComputerRefusal)
    session.open('run')
    await expect(session.act('run', 'nope', { kind: 'key', key: 'Enter' })).rejects.toThrow(/out of date/)
    const first = await session.observe('run')
    await session.act('run', first.id, { kind: 'click', x: 10, y: 10 })
    expect(backend.performed).toEqual([{ kind: 'click', x: 10, y: 10 }])
    // The action consumed the observation.
    await expect(session.act('run', first.id, { kind: 'key', key: 'Enter' })).rejects.toThrow(/out of date/)
  })

  it('rejects out-of-range points and oversize text before touching the computer', async () => {
    const { session, backend } = setup()
    session.open('run')
    const frame = await session.observe('run')
    await expect(session.act('run', frame.id, { kind: 'click', x: 400, y: 10 })).rejects.toThrow(/outside/)
    const again = await session.observe('run')
    await expect(session.act('run', again.id, { kind: 'type', text: 'x'.repeat(2001) })).rejects.toThrow(/characters/)
    expect(backend.performed).toEqual([])
  })

  it('keeps observation and input grants separate', async () => {
    const view = setup({ input: false })
    view.session.open('run')
    const frame = await view.session.observe('run')
    await expect(view.session.act('run', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/Input is not granted/)
    const blind = setup({ observe: false })
    blind.session.open('run')
    await expect(blind.session.observe('run')).rejects.toThrow(/not granted/)
    await expect(blind.session.view()).rejects.toThrow(/not granted/)
  })

  it('refuses agent work while a person controls, and requires a fresh observation after they give it back', async () => {
    const { session, backend } = setup()
    session.open('run')
    const frame = await session.observe('run')
    session.takeControl('phone')
    expect(backend.released).toBeGreaterThan(0)
    await expect(session.act('run', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/out of date|controlling/)
    expect(() => session.open('run')).toThrow(/controlling|Another/)
    session.giveToAgent('phone', 'run')
    await expect(session.act('run', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/out of date/)
    const fresh = await session.observe('run')
    await session.act('run', fresh.id, { kind: 'key', key: 'a' })
    expect(backend.performed).toEqual([{ kind: 'key', key: 'a' }])
  })

  it('drops queued agent actions when a person takes over, and waits for in-flight work', async () => {
    const { session, backend } = setup()
    session.open('run')
    const frame = await session.observe('run')
    let release!: () => void
    backend.hold = new Promise<void>((resolve) => (release = resolve))
    const inFlight = session.act('run', frame.id, { kind: 'key', key: 'a' })
    const queued = session.act('run', frame.id, { kind: 'key', key: 'b' })
    const queuedResult = expect(queued).rejects.toBeInstanceOf(ComputerRefusal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.takeControl('phone')
    // The agent's last action has not settled, so human input is held back.
    const view = { capturedAt: 1000 }
    await expect(session.humanInput('phone', session.state.generation, { kind: 'key', key: 'x' })).rejects.toThrow(
      /finishing/,
    )
    release()
    await inFlight
    await queuedResult
    await session.humanInput('phone', session.state.generation, { kind: 'key', key: 'x' })
    expect(backend.performed.map((action) => ('key' in action ? action.key : ''))).toEqual(['a', 'x'])
  })

  it('shows a watcher the picture an action came back with, without waiting for the next capture', async () => {
    const { session, backend } = setup()
    const after: ComputerCapture = { mimeType: 'image/png', data: 'QUZURVI=', width: 400, height: 300, scale: 1 }
    backend.perform = async (_target, action) => {
      backend.performed.push(action)
      return after
    }
    const first = await session.view()
    session.takeControl('phone')
    await session.humanInput('phone', session.state.generation, { kind: 'click', x: 1, y: 1 })
    const next = await session.view(first.hash)
    expect(next.capture.data).toBe('QUZURVI=')
  })

  it('accepts human input only from the controller, on a current generation and a fresh frame', async () => {
    const { session, tick } = setup()
    session.takeControl('phone')
    const generation = session.state.generation
    const frame = { capturedAt: 1000 }
    const action: ComputerAction = { kind: 'click', x: 5, y: 5 }
    await expect(session.humanInput('tablet', generation, action)).rejects.toThrow(/does not control/)
    await expect(session.humanInput('phone', generation - 1, action)).rejects.toThrow(/Control changed/)
    // An old picture is no reason to refuse a person's input.
    tick(60_000)
    await session.humanInput('phone', generation, action)
  })

  it('lets another of the person’s devices take over, and back', () => {
    const { session } = setup()
    session.takeControl('phone')
    session.takeControl('desktop-b')
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'desktop-b' })
    session.takeControl('phone')
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'phone' })
  })

  it('pauses on controller disconnect without handing control back, and releases held input', () => {
    const { session, backend } = setup()
    session.takeControl('phone')
    const before = backend.released
    session.controllerDisconnected('phone')
    expect(session.state.paused).toBe(true)
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'phone' })
    expect(backend.released).toBeGreaterThan(before)
    expect(() => session.open('run')).toThrow()
  })

  it('reports an action that failed as possibly applied and never retries it', async () => {
    const { session, backend } = setup()
    session.open('run')
    const frame = await session.observe('run')
    backend.failNext = true
    await expect(session.act('run', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/may or may not have run/)
    expect(backend.performed).toEqual([])
    await expect(session.act('run', frame.id, { kind: 'key', key: 'a' })).rejects.toThrow(/out of date/)
  })

  it('stops a run without disturbing a person who took over, and revoking closes the session', async () => {
    const { session, service } = setup()
    session.open('run')
    session.takeControl('phone')
    service.endRun('thread', 'run')
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'phone' })
    service.revoke('thread')
    expect(service.session('thread')).toBeUndefined()
    await expect(session.view()).rejects.toThrow(/closed/)
  })

  it('replaces an earlier grant for the thread and revokes the old session', async () => {
    const { service, session } = setup()
    const replacement = service.grant('thread', grant({ target: { id: 'notes', kind: 'app', name: 'Notes' } }))
    expect(replacement.target.id).toBe('notes')
    await expect(session.view()).rejects.toThrow(/closed/)
  })
})
