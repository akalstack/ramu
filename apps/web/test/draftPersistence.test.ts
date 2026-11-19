import { afterEach, beforeEach, expect, it, vi } from 'vitest'

interface Instance {
  refs: { current: unknown }[]
  effects: { deps: readonly unknown[]; cleanup?: () => void }[]
  pending: (() => void)[]
  refIndex: number
  effectIndex: number
}
const environment = vi.hoisted(() => ({
  instance: null as Instance | null,
  data: new Map<string, string>(),
  readDenied: false,
  writeDenied: false,
  removeDenied: false,
}))
vi.mock('react', () => ({
  useRef(initial: unknown) {
    const instance = environment.instance!,
      index = instance.refIndex++
    return (instance.refs[index] ??= { current: initial })
  },
  useEffect(run: () => void | (() => void), deps: readonly unknown[]) {
    const instance = environment.instance!,
      index = instance.effectIndex++,
      previous = instance.effects[index]
    if (
      previous &&
      deps.length === previous.deps.length &&
      deps.every((value, index) => Object.is(value, previous.deps[index]))
    )
      return
    instance.pending.push(() => {
      previous?.cleanup?.()
      const cleanup = run()
      instance.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    })
  },
}))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'a' }))
vi.mock('../src/hostStorage', () => ({
  ownHostStore: () => null,
  storeForHost: (host: string) => ({
    getItem: (key: string) => {
      if (environment.readDenied) throw new Error('Denied')
      return environment.data.get(`${host}:${key}`) ?? null
    },
    setItem: (key: string, value: string) => {
      if (environment.writeDenied) throw new Error('Quota')
      environment.data.set(`${host}:${key}`, value)
    },
    removeItem: (key: string) => {
      if (environment.removeDenied) throw new Error('Denied')
      environment.data.delete(`${host}:${key}`)
    },
    key: () => null,
    length: 0,
  }),
}))
import { storeForHost } from '../src/hostStorage'
import { loadDraft, saveDraft, useDraftPersistence } from '../src/composer/drafts'
import { allWorkspaceCheckpoints } from '../src/workspace/workspaceCheckpoint'

const instances: Instance[] = []
function instance(): Instance {
  const value: Instance = { refs: [], effects: [], pending: [], refIndex: 0, effectIndex: 0 }
  instances.push(value)
  return value
}
function RenderPersistence(target: Instance, key: string, value: string, host = 'a') {
  environment.instance = target
  target.refIndex = target.effectIndex = 0
  const consume = useDraftPersistence(key, value, host)
  while (target.pending.length) target.pending.shift()!()
  return consume
}
function dispose(target: Instance) {
  for (const effect of target.effects) effect.cleanup?.()
  target.effects = []
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  environment.data.clear()
  environment.readDenied = environment.writeDenied = environment.removeDenied = false
})
afterEach(() => {
  for (const target of instances.splice(0)) dispose(target)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('does not resurrect a sent legacy draft from its timer, pagehide, checkpoint or unmount flush', async () => {
  const target = instance(),
    key = 'new:p'
  saveDraft(key, 'Send this', storeForHost('a'))
  const consume = RenderPersistence(target, key, 'Send this')
  expect(consume().persisted).toBe(true)
  expect(loadDraft(key, storeForHost('a'))).toBe('')
  await vi.advanceTimersByTimeAsync(1000)
  // A same-value parent render must not turn the acknowledged snapshot into a fresh draft.
  RenderPersistence(target, key, 'Send this')
  expect(await Promise.all(allWorkspaceCheckpoints().map((checkpoint) => checkpoint()))).toEqual([true])
  window.dispatchEvent(new Event('pagehide'))
  dispose(target)
  expect(loadDraft(key, storeForHost('a'))).toBe('')
})

it('consumes an older own autosave when Send was faster than the latest debounce', async () => {
  const target = instance(),
    key = 'chat:s'
  RenderPersistence(target, key, 'Earlier')
  await vi.advanceTimersByTimeAsync(350)
  const consume = RenderPersistence(target, key, 'Latest message')
  expect(loadDraft(key, storeForHost('a'))).toBe('Earlier')
  expect(consume().persisted).toBe(true)
  dispose(target)
  expect(loadDraft(key, storeForHost('a'))).toBe('')
})

it('preserves edits made before acknowledgement, including editing back to identical text', async () => {
  const target = instance(),
    key = 'chat:s'
  const consume = RenderPersistence(target, key, 'Original')
  RenderPersistence(target, key, 'New work')
  expect(consume().persisted).toBe(true)
  window.dispatchEvent(new Event('pagehide'))
  expect(loadDraft(key, storeForHost('a'))).toBe('New work')
  const older = RenderPersistence(target, key, 'Repeated text')
  RenderPersistence(target, key, 'An intervening edit')
  RenderPersistence(target, key, 'Repeated text')
  expect(older().unchanged).toBe(false)
  await vi.advanceTimersByTimeAsync(350)
  expect(loadDraft(key, storeForHost('a'))).toBe('Repeated text')
})

it('binds late acknowledgements to their original host and scope', async () => {
  const target = instance(),
    key = 'new:p'
  const consume = RenderPersistence(target, key, 'Host A', 'a')
  RenderPersistence(target, key, 'Host B', 'b')
  consume()
  await vi.advanceTimersByTimeAsync(350)
  expect(loadDraft(key, storeForHost('a'))).toBe('')
  expect(loadDraft(key, storeForHost('b'))).toBe('Host B')
})

it('does not erase another window’s newer save even when its text is identical', async () => {
  const first = instance(),
    second = instance(),
    key = 'chat:s'
  const consume = RenderPersistence(first, key, 'Same request')
  await vi.advanceTimersByTimeAsync(350)
  RenderPersistence(second, key, 'Same request')
  await vi.advanceTimersByTimeAsync(350)
  const other = environment.data.get(`a:ramu.draft.${key}`)
  expect(consume().persisted).toBe(true)
  RenderPersistence(first, key, '')
  await vi.advanceTimersByTimeAsync(350)
  dispose(first)
  expect(environment.data.get(`a:ramu.draft.${key}`)).toBe(other)
  expect(loadDraft(key, storeForHost('a'))).toBe('Same request')
})

it('does not adopt a different window’s newer baseline when the first window edits before sending', async () => {
  const first = instance(),
    second = instance(),
    key = 'chat:s'
  RenderPersistence(first, key, 'Earlier request')
  await vi.advanceTimersByTimeAsync(350)
  RenderPersistence(second, key, 'Another window’s work')
  await vi.advanceTimersByTimeAsync(350)
  const consume = RenderPersistence(first, key, 'Edited first-window request')
  consume()
  RenderPersistence(first, key, '')
  await vi.advanceTimersByTimeAsync(350)
  expect(loadDraft(key, storeForHost('a'))).toBe('Another window’s work')
})

it('reports failed cleanup and preserves corrupt or inaccessible storage without retrying delivery', async () => {
  const target = instance(),
    key = 'new:p'
  const consume = RenderPersistence(target, key, 'Sent')
  await vi.advanceTimersByTimeAsync(350)
  environment.removeDenied = true
  expect(consume().persisted).toBe(false)
  environment.removeDenied = false
  expect(consume().persisted).toBe(true)
  RenderPersistence(target, key, 'Another request')
  environment.data.set(`a:ramu.draft.${key}`, '{')
  expect(RenderPersistence(target, key, 'Another request')().persisted).toBe(false)
  expect(environment.data.get(`a:ramu.draft.${key}`)).toBe('{')
})
