import { describe, expect, it, vi } from 'vitest'
import { createEventPump, createHostEventRouter } from '../src/workspace/hostEvents'
import {
  createHostRuntime,
  createMountRequests,
  createRuntimeRegistry,
  mountedHosts,
  type HostRuntimeDeps,
} from '../src/workspace/hostRuntime'
import { hostStore, type Store } from '../src/hostStorage'
import { fakeBridge } from './fakeBridge'

const memory = (): Store => {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}

function setup(own = 'local') {
  const bridge = fakeBridge()
  const router = createHostEventRouter(bridge as never, () => own)
  const ticks: (() => void)[] = []
  const pump = createEventPump({ schedule: (run) => void ticks.push(run) })
  const base = memory()
  const calls: { host: string; method: string; args: unknown[] }[] = []
  const deps = (host: string): HostRuntimeDeps => ({
    invoke: (async (method: string, ...args: unknown[]) => {
      calls.push({ host, method, args })
      return method === 'term.busy' ? 0 : undefined
    }) as never,
    storage: hostStore(base, host),
    router,
    pump,
  })
  const runAll = () => {
    while (ticks.length) ticks.shift()!()
  }
  return { bridge, router, pump, base, calls, deps, runAll }
}

describe('per-host runtime', () => {
  it('keeps two hosts’ storage, terminals and terminal activity apart', () => {
    const env = setup()
    const local = createHostRuntime('local', env.deps('local'))
    const studio = createHostRuntime('studio', env.deps('studio'), false)
    local.storage.setItem('ramu.unread', '["a"]')
    studio.storage.setItem('ramu.unread', '["b"]')
    expect(env.base.getItem('host:local:ramu.unread')).toBe('["a"]')
    expect(env.base.getItem('host:studio:ramu.unread')).toBe('["b"]')

    local.terminals.trackTerminal('view-1', 'shell-1')
    expect(local.terminals.shellOf('view-1')).toBe('shell-1')
    expect(studio.terminals.shellOf('view-1')).toBeUndefined()
    studio.terminals.queueAdopt('project:p', 'shell-9')
    expect(local.terminals.adoptQueued('project:p', 'shell-9')).toBe(false)
    expect(studio.terminals.takeAdopted('project:p')).toBe('shell-9')

    local.activity.markTerminalOutput('project:p')
    expect(studio.activity.hasUnseenTerminalOutput('project:p')).toBe(false)
  })

  it('closes a shell through its own host', async () => {
    const env = setup()
    const studio = createHostRuntime('studio', env.deps('studio'), false)
    studio.terminals.trackTerminal('view', 'shell')
    const proceed = vi.fn()
    studio.terminals.closeAfterTerminalCheck(['view'], proceed)
    await vi.waitFor(() => expect(proceed).toHaveBeenCalled())
    expect(env.calls.map((call) => `${call.host}:${call.method}`)).toEqual(['studio:term.busy', 'studio:term.close'])
  })

  it('routes terminal output by host id, even when two hosts reuse a shell id', () => {
    const env = setup()
    const local = createHostRuntime('local', env.deps('local'))
    const studio = createHostRuntime('studio', env.deps('studio'))
    const seenLocal = vi.fn(),
      seenStudio = vi.fn()
    local.terminals.onData('shell', seenLocal)
    studio.terminals.onData('shell', seenStudio)
    env.bridge.emit('term:data', { id: 'shell', data: 'hi', cursor: 2 }, 'studio')
    expect(seenStudio).toHaveBeenCalledWith({ id: 'shell', data: 'hi', cursor: 2 })
    expect(seenLocal).not.toHaveBeenCalled()
  })

  it('applies events at once on screen and through the pump off screen', () => {
    const env = setup()
    const studio = createHostRuntime('studio', env.deps('studio'), false)
    const apply = vi.fn()
    studio.deliver('refresh', apply)
    studio.deliver('refresh', apply)
    expect(apply).not.toHaveBeenCalled()
    env.runAll()
    expect(apply).toHaveBeenCalledTimes(1)

    const local = createHostRuntime('local', env.deps('local'))
    const now = vi.fn()
    local.deliver('refresh', now)
    expect(now).toHaveBeenCalledTimes(1)
    expect(env.pump.pending()).toBe(0)
  })

  it('holds a hidden host’s terminal output (bounded) and delivers it when the host comes on screen', () => {
    const env = setup()
    const studio = createHostRuntime('studio', env.deps('studio'), false)
    const chunks: unknown[] = []
    const exits: number[] = []
    studio.terminals.onData('shell', (chunk) => chunks.push(chunk))
    studio.terminals.onExit('shell', (code) => exits.push(code))
    env.bridge.emit('term:data', { id: 'shell', data: 'ab', cursor: 2 }, 'studio')
    env.bridge.emit('term:data', { id: 'shell', data: 'cd', cursor: 4 }, 'studio')
    // A shell nobody shows is not held: the host keeps its output for the next snapshot.
    env.bridge.emit('term:data', { id: 'other', data: 'zz', cursor: 2 }, 'studio')
    env.bridge.emit('term:exit', { id: 'shell', code: 0 }, 'studio')
    expect(chunks).toEqual([])
    expect(studio.terminals.bufferedChars()).toBe(4)
    const pending = vi.fn()
    studio.deliver('refresh', pending)
    studio.setActive(true)
    expect(chunks).toEqual([{ id: 'shell', data: 'abcd', cursor: 4 }])
    expect(exits).toEqual([0])
    expect(pending).toHaveBeenCalledTimes(1)
    expect(studio.terminals.bufferedChars()).toBe(0)
  })

  it('drops held output when the view stops listening', () => {
    const env = setup()
    const studio = createHostRuntime('studio', env.deps('studio'), false)
    const off = studio.terminals.onData('shell', () => {})
    env.bridge.emit('term:data', { id: 'shell', data: 'abc', cursor: 3 }, 'studio')
    off()
    expect(studio.terminals.bufferedChars()).toBe(0)
    expect(env.bridge.count('term:data')).toBe(0)
  })
})

describe('lazy mounting', () => {
  it('creates a runtime only when a host’s store first asks, and disposes it when unmounted', () => {
    const env = setup()
    const create = vi.fn((host: string) => createHostRuntime(host, env.deps(host), host === 'local'))
    const registry = createRuntimeRegistry(create)
    expect(registry.hosts()).toEqual([])
    const studio = registry.get('studio')
    expect(registry.get('studio')).toBe(studio)
    expect(create).toHaveBeenCalledTimes(1)
    studio.deliver('refresh', () => {})
    expect(env.pump.pending('studio')).toBe(1)
    registry.retain(['local'])
    expect(registry.has('studio')).toBe(false)
    expect(env.pump.pending('studio')).toBe(0)
  })

  it('mounts only the window’s own host for a single-host user', () => {
    expect(mountedHosts({ own: 'local', active: 'local', requested: [], status: () => 'connected' })).toEqual(['local'])
  })

  it('mounts requested hosts while they are live, keeping own and active first', () => {
    const status = (host: string) =>
      ({ local: 'connected', studio: 'connected', lab: 'offline', box: 'connecting' })[host] as never
    expect(mountedHosts({ own: 'local', active: 'local', requested: ['lab', 'studio', 'box'], status })).toEqual([
      'local',
      'studio',
      'box',
    ])
    // The host on screen always has a store, whatever its state.
    expect(mountedHosts({ own: 'local', active: 'lab', requested: ['studio'], status })).toEqual([
      'local',
      'lab',
      'studio',
    ])
  })

  it('remembers requests until the host is forgotten, notifying only on change', () => {
    const requests = createMountRequests()
    const changed = vi.fn()
    requests.subscribe(changed)
    requests.request('studio')
    requests.request('studio')
    requests.request('lab')
    expect(requests.snapshot()).toEqual(['studio', 'lab'])
    expect(changed).toHaveBeenCalledTimes(2)
    const before = requests.snapshot()
    requests.retain(() => true)
    expect(requests.snapshot()).toBe(before)
    requests.retain((host) => host !== 'lab')
    expect(requests.snapshot()).toEqual(['studio'])
  })
})
