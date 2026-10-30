import { describe, expect, it, vi } from 'vitest'
import type { ComputerAction, ComputerBackend, ComputerCapture, ComputerTarget } from '@ramu/shared/computerBridge'
import { MacosComputerBackend, parseHidIdleMs } from '../src/computer/macos'
import { ComputerService } from '../src/computer/service'
import { ComputerRefusal } from '../src/computer/session'

const display: ComputerTarget = { id: 'display:main', kind: 'display', name: 'Main display' }
const app: ComputerTarget = { id: 'app:Calculator', kind: 'app', name: 'Calculator' }

class Fake implements ComputerBackend {
  performed: ComputerAction[] = []
  released = 0
  localInputActive?: () => Promise<boolean>
  status() {
    return { available: true as const, computer: { id: 'a', name: 'Laptop' } }
  }
  async capture(): Promise<ComputerCapture> {
    return { mimeType: 'image/jpeg', data: 'AA==', width: 400, height: 300, scale: 2 }
  }
  async perform(_target: ComputerTarget, action: ComputerAction) {
    this.performed.push(action)
  }
  releaseInput() {
    this.released++
  }
}

const setup = (target: ComputerTarget, active?: () => boolean) => {
  const backend = new Fake()
  if (active) backend.localInputActive = async () => active()
  let clock = 1000
  const service = new ComputerService(backend, () => clock)
  const session = service.grant('thread', { target, observe: true, input: true })
  return { backend, session, tick: (ms: number) => (clock += ms) }
}

describe('local mouse and keyboard use', () => {
  it('pauses the agent and hands control to the person when the real mouse or keyboard is used', async () => {
    let busy = false
    const { session, backend } = setup(display, () => busy)
    session.open('run')
    const frame = await session.observe('run')
    busy = true
    await expect(session.act('run', frame.id, { kind: 'click', x: 1, y: 1 })).rejects.toThrow(/mouse or keyboard/)
    expect(backend.performed).toEqual([])
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'local' })
    expect(session.interruption).toBe('local-input')
    busy = false
    session.giveToAgent('local', 'run')
    expect(session.interruption).toBeNull()
  })

  it('lets local use outrank a remote human controller', async () => {
    let busy = false
    const { session } = setup(display, () => busy)
    session.takeControl('phone')
    const generation = session.state.generation
    busy = true
    await expect(
      session.humanInput('phone', generation, { capturedAt: 1000 }, { kind: 'key', key: 'a' }),
    ).rejects.toThrow(/mouse or keyboard/)
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'local' })
  })

  it('does not look at the real pointer for an app, which is driven in the background', async () => {
    const check = vi.fn(() => true)
    const { session, backend } = setup(app, check)
    session.open('run')
    const frame = await session.observe('run')
    await session.act('run', frame.id, { kind: 'click', x: 1, y: 1 })
    expect(check).not.toHaveBeenCalled()
    expect(backend.performed).toHaveLength(1)
  })

  it('says when a display cannot detect local input', () => {
    expect(setup(display).session.detectsLocalInput).toBe(false)
    expect(setup(display, () => false).session.detectsLocalInput).toBe(true)
    expect(setup(app).session.detectsLocalInput).toBe(true)
  })
})

describe('handoff between devices', () => {
  it('hands control to a device the controlling device approves', () => {
    const { session, backend } = setup(app)
    session.takeControl('phone')
    session.requestHandoff('desktop')
    expect(session.handoffRequest).toBe('desktop')
    const generation = session.state.generation
    session.approveHandoff('phone')
    expect(session.state.controller).toEqual({ kind: 'human', deviceId: 'desktop' })
    expect(session.state.generation).toBeGreaterThan(generation)
    expect(session.handoffRequest).toBeNull()
    expect(backend.released).toBeGreaterThan(0)
  })

  it('lets only the controller answer and drops a declined or expired request', () => {
    const { session, tick } = setup(app)
    expect(() => session.requestHandoff('desktop')).toThrow(ComputerRefusal)
    session.takeControl('phone')
    expect(() => session.requestHandoff('phone')).toThrow(/already controls/)
    session.requestHandoff('desktop')
    expect(() => session.approveHandoff('desktop')).toThrow(ComputerRefusal)
    session.declineHandoff('phone')
    expect(session.handoffRequest).toBeNull()
    session.requestHandoff('desktop')
    tick(130_000)
    expect(session.handoffRequest).toBeNull()
    expect(() => session.approveHandoff('phone')).toThrow(/asking/)
  })

  it('drops a request once control changes hands another way', () => {
    const { session } = setup(app)
    session.takeControl('phone')
    session.requestHandoff('desktop')
    session.takeControl('local')
    expect(session.handoffRequest).toBeNull()
  })
})

describe('physical input detection on macOS', () => {
  const registry = (ns: number) => `| |   "HIDIdleTime" = ${ns}`

  it('reads the idle time in milliseconds', () => {
    expect(parseHidIdleMs(registry(1_500_000_000))).toBe(1500)
    expect(parseHidIdleMs('nothing')).toBeNull()
  })

  it('treats recent input as the person unless Ramu injected it', async () => {
    let idle = 300_000_000
    const exec = vi.fn(async (file: string) => (file.endsWith('ioreg') ? registry(idle) : ''))
    const backend = new MacosComputerBackend(exec, 'darwin')
    expect(await backend.localInputActive()).toBe(true)
    idle = 5_000_000_000
    expect(await backend.localInputActive()).toBe(false)
    await backend.perform(display, { kind: 'key', key: 'a' })
    idle = 50_000_000
    expect(await backend.localInputActive()).toBe(false)
  })

  it('releases held input after an interrupted action settles', async () => {
    const scripts: string[] = []
    let finish: () => void = () => {}
    const exec = vi.fn(async (file: string, args: string[]) => {
      if (file.endsWith('osascript')) {
        scripts.push(args.at(-1)!)
        if (scripts.length === 1) await new Promise<void>((resolve) => (finish = resolve))
      }
      return ''
    })
    const backend = new MacosComputerBackend(exec, 'darwin')
    const pending = backend.perform(display, { kind: 'drag', fromX: 1, fromY: 1, toX: 9, toY: 9 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    backend.releaseInput()
    finish()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(scripts.at(-1)).toContain('kCGEventLeftMouseUp')
  })
})
