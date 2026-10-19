import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  host: 'a',
  status: 'connected',
  values: [] as unknown[],
  index: 0,
  dependencies: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
  pendingEffect: undefined as (() => void) | undefined,
  requests: [] as {
    method: string
    host: string
    project: string
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }[],
  listeners: new Map<string, () => void>(),
}))
const invoke = vi.hoisted(
  () => (method: string, project: string) =>
    new Promise((resolve, reject) => {
      state.requests.push({ host: state.host, method, project, resolve, reject })
    }),
)
const runtime = vi.hoisted(() => ({
  on: (channel: string, listener: () => void) => {
    const key = `${state.host}:${channel}`
    state.listeners.set(key, listener)
    return () => {
      state.listeners.delete(key)
    }
  },
}))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = next
      },
    ]
  },
  useEffect: (run: () => () => void, dependencies: unknown[]) => {
    if (state.dependencies && dependencies.every((value, index) => Object.is(value, state.dependencies![index]))) return
    state.pendingEffect = () => {
      state.cleanup?.()
      state.cleanup = run()
      state.dependencies = dependencies
    }
  },
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: state.host, status: state.status, invoke }) }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => runtime }))
import { PROJECT_ACTIONS_EVENT, useProjectActions } from '../src/workspace/useProjectActions'
import { useProjectActionSettings } from '../src/workspace/useProjectActionSettings'

function RenderActions(project?: string) {
  state.index = 0
  const result = useProjectActions(project)
  const effect = state.pendingEffect
  state.pendingEffect = undefined
  effect?.()
  return result
}
function RenderSettings(project: string) {
  state.index = 0
  const result = useProjectActionSettings(project)
  const effect = state.pendingEffect
  state.pendingEffect = undefined
  effect?.()
  return result
}
const action = (name: string) => [{ id: 'test', name, command: 'echo test', source: 'ramu.json' }]
beforeEach(() => {
  state.host = 'a'
  state.status = 'connected'
  state.values = []
  state.index = 0
  state.dependencies = undefined
  state.cleanup = undefined
  state.pendingEffect = undefined
  state.requests = []
  state.listeners.clear()
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  state.cleanup?.()
  vi.unstubAllGlobals()
})

it('refreshes repository actions after a host event and ignores an older in-flight response', async () => {
  expect(RenderActions('p')).toEqual([])
  state.listeners.get('a:workspace:changed')!()
  state.requests[1]!.resolve(action('New definition'))
  await Promise.resolve()
  expect(RenderActions('p')[0]?.name).toBe('New definition')
  state.requests[0]!.resolve(action('Old definition'))
  await Promise.resolve()
  expect(RenderActions('p')[0]?.name).toBe('New definition')
  window.dispatchEvent(new Event(PROJECT_ACTIONS_EVENT))
  expect(state.requests).toHaveLength(3)
})

it('keeps colliding project IDs isolated across hosts and ignores responses after disposal', async () => {
  RenderActions('p')
  state.requests[0]!.resolve(action('Host A'))
  await Promise.resolve()
  expect(RenderActions('p')[0]?.name).toBe('Host A')
  state.listeners.get('a:workspace:changed')!()
  state.host = 'b'
  expect(RenderActions('p')).toEqual([])
  expect(state.listeners.has('a:workspace:changed')).toBe(false)
  state.requests[1]!.resolve(action('Late A'))
  state.requests[2]!.resolve(action('Host B'))
  await Promise.resolve()
  expect(RenderActions('p')[0]?.name).toBe('Host B')
  state.listeners.get('b:workspace:changed')!()
  state.cleanup?.()
  state.requests[3]!.resolve(action('After close'))
  await Promise.resolve()
  expect(RenderActions('p')[0]?.name).toBe('Host B')
})

it('clears actions on project changes or failed refreshes and reloads on reconnect', async () => {
  RenderActions('p')
  state.requests[0]!.resolve(action('Project P'))
  await Promise.resolve()
  expect(RenderActions('q')).toEqual([])
  expect(state.requests[1]!.project).toBe('q')
  state.requests[1]!.resolve(action('Project Q'))
  await Promise.resolve()
  expect(RenderActions('q')[0]?.name).toBe('Project Q')
  state.status = 'disconnected'
  RenderActions('q')
  state.requests[2]!.reject(new Error('Offline'))
  await Promise.resolve()
  expect(RenderActions('q')).toEqual([])
  state.status = 'connected'
  RenderActions('q')
  expect(state.requests[3]!.project).toBe('q')
  state.requests[3]!.resolve([])
  await Promise.resolve()
  expect(RenderActions('q')).toEqual([])
})

it('loads hidden-action metadata on the correct host and ignores superseded reads and closed dialogs', async () => {
  RenderSettings('p')
  expect(state.requests[0]!.method).toBe('projects.actionSettings')
  state.listeners.get('a:workspace:changed')!()
  const settings = { actions: action('Current'), hiddenIds: ['test'], customOrder: true }
  state.requests[1]!.resolve(settings)
  await Promise.resolve()
  expect(RenderSettings('p')).toMatchObject({ ...settings, supported: true, loading: false })
  state.requests[0]!.resolve({ ...settings, hiddenIds: [] })
  await Promise.resolve()
  expect(RenderSettings('p').hiddenIds).toEqual(['test'])
  state.host = 'b'
  expect(RenderSettings('p').actions).toEqual([])
  state.requests[2]!.resolve({ actions: action('Host B'), hiddenIds: [], customOrder: false })
  await Promise.resolve()
  expect(RenderSettings('p').actions[0]!.name).toBe('Host B')
  state.listeners.get('b:workspace:changed')!()
  state.cleanup?.()
  state.requests[3]!.resolve(settings)
  await Promise.resolve()
  expect(RenderSettings('p').actions[0]!.name).toBe('Host B')
})

it('reports unsupported hosts without exposing management commands and retries after reconnect', async () => {
  RenderSettings('p')
  state.requests[0]!.reject(new Error('Unknown method projects.actionSettings'))
  await Promise.resolve()
  expect(RenderSettings('p')).toMatchObject({
    supported: false,
    loading: false,
    error: 'Unknown method projects.actionSettings',
  })
  state.status = 'disconnected'
  RenderSettings('p')
  state.requests[1]!.reject(new Error('Offline'))
  await Promise.resolve()
  expect(RenderSettings('p').actions).toEqual([])
  state.status = 'connected'
  RenderSettings('p')
  state.requests[2]!.resolve({ actions: [], hiddenIds: [], customOrder: false })
  await Promise.resolve()
  expect(RenderSettings('p')).toMatchObject({ supported: true, error: '' })
})
