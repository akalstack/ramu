import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@ramu/shared/types'
import type { ProjectAgentDefaults } from '@ramu/shared/workspace/agentDefaults'
const state = vi.hoisted(() => ({
  host: 'a',
  project: 'p',
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; dispose?: () => void }[],
  pending: [] as (() => void)[],
  index: 0,
  refIndex: 0,
  effectIndex: 0,
  data: new Map<string, string>(),
  denied: false,
  results: new Map<string, ProjectAgentDefaults>(),
  queryError: undefined as Error | undefined,
  updates: [] as unknown[],
  listeners: new Map<string, () => void>(),
  invoke: vi.fn(),
}))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = next
      },
    ]
  },
  useRef(initial: unknown) {
    return (state.refs[state.refIndex++] ??= { current: initial })
  },
  useEffect(run: () => void | (() => void), deps: unknown[]) {
    const index = state.effectIndex++,
      prior = state.effects[index]
    if (prior && deps.every((dep, i) => Object.is(dep, prior.deps[i]))) return
    state.pending.push(() => {
      prior?.dispose?.()
      state.effects[index] = { deps, dispose: run() || undefined }
    })
  },
}))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ id: state.host, status: 'connected', invoke: state.invoke }),
}))
const runtime = vi.hoisted(() => ({
  on: (channel: string, read: () => void) => {
    state.listeners.set(channel, read)
    return () => state.listeners.delete(channel)
  },
}))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => runtime }))
const client = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setQueryData: (key: unknown[], result: ProjectAgentDefaults) => {
    state.updates.push(key)
    state.results.set(JSON.stringify(key), result)
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => client,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: state.results.get(JSON.stringify(queryKey)),
    error: state.queryError,
  }),
}))
vi.mock('../src/composer/drafts', () => ({
  draftStore: (host: string) => ({
    getItem: (key: string) => state.data.get(`${host}:${key}`) ?? null,
    setItem: (key: string, value: string) => {
      if (state.denied) throw Error('Storage full')
      state.data.set(`${host}:${key}`, value)
    },
    removeItem: (key: string) => state.data.delete(`${host}:${key}`),
  }),
}))
import { useAgentDraft } from '../src/composer/useAgentDraft'
const base: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model: 'host-model', access: 'edits' }
const repository: ProjectAgentDefaults = {
  status: 'ready',
  source: 'ramu.json',
  requested: { provider: 'claude-code' },
  selection: { provider: 'claude-code', model: 'repo-model', effort: 'low' },
}
function result(value: ProjectAgentDefaults) {
  state.results.set(JSON.stringify(['project-agent-defaults', state.host, state.project, base.provider]), value)
}
function render(settings = base) {
  state.index = state.refIndex = state.effectIndex = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- test harness renders the hook with a mocked React
  const value = useAgentDraft(state.project, settings)
  for (const effect of state.pending.splice(0)) effect()
  return value
}
beforeEach(() => {
  state.host = 'a'
  state.project = 'p'
  state.values = []
  state.refs = []
  state.effects = []
  state.pending = []
  state.data.clear()
  state.denied = false
  state.results.clear()
  state.updates = []
  state.listeners.clear()
  state.queryError = undefined
  state.invoke.mockReset()
  client.invalidateQueries.mockClear()
  result(repository)
})
afterEach(() => {
  for (const effect of state.effects) effect?.dispose?.()
})
it('follows repository defaults until a person chooses a model, preserving manual settings across changed host defaults', () => {
  expect(render().settings).toMatchObject({ provider: 'claude-code', model: 'repo-model', access: 'edits' })
  render().change({ ...render().settings, access: 'auto' })
  result({ ...repository, selection: { ...repository.selection!, model: 'new-repo-model' } })
  expect(render().settings).toMatchObject({ model: 'new-repo-model', access: 'auto' })
  render().change({ ...render().settings, provider: 'codex', model: 'manual-model' })
  expect(render({ ...base, model: 'new-host-model' }).settings).toMatchObject({
    provider: 'codex',
    model: 'manual-model',
    access: 'auto',
  })
  render().useProjectDefault()
  expect(render().settings).toMatchObject({ model: 'new-repo-model', access: 'auto' })
})
it('keeps scopes isolated, restores explicit choices and fences a late preflight response after switching hosts', async () => {
  render().change({ ...base, model: 'manual-model' })
  state.host = 'b'
  result(repository)
  expect(render().settings.model).toBe('repo-model')
  state.host = 'a'
  expect(render().settings.model).toBe('manual-model')
  render().useProjectDefault()
  render()
  let resolve!: (result: ProjectAgentDefaults) => void
  state.invoke.mockImplementation(
    () =>
      new Promise<ProjectAgentDefaults>((done) => {
        resolve = done
      }),
  )
  const pending = render().verify()
  state.host = 'b'
  render()
  resolve({ ...repository, selection: { ...repository.selection!, model: 'late-a-model' } })
  await expect(pending).rejects.toThrow('draft changed')
  expect(state.updates).toEqual([])
  expect(render().settings.model).toBe('repo-model')
})
it('requires review when the authoritative selection changes before send and then verifies the new displayed model', async () => {
  state.invoke.mockResolvedValue({
    ...repository,
    selection: { ...repository.selection!, model: 'updated-before-send' },
  })
  await expect(render().verify()).rejects.toThrow('defaults changed')
  expect(render().settings.model).toBe('updated-before-send')
  expect((await render().verify()).model).toBe('updated-before-send')
  expect(state.invoke).toHaveBeenCalledWith('tasks.agentDefaults', 'p', 'codex')
  result({ status: 'unavailable', source: 'ramu.json', reason: 'provider' })
  expect(render().blocked).toBe(true)
  render().useHostDefault()
  expect(render().blocked).toBe(false)
  expect((await render().verify()).model).toBe('host-model')
})
it('never overwrites corrupt metadata on Retry and keeps explicit choices usable when persistence fails', async () => {
  state.data.set('a:ramu.new-thread-agent:p', '{"version":99}')
  state.values = []
  state.effects = []
  state.pending = []
  expect(render().blocked).toBe(true)
  render().retry()
  expect(state.data.get('a:ramu.new-thread-agent:p')).toBe('{"version":99}')
  state.denied = true
  render().change({ ...base, model: 'chosen-in-memory' })
  expect(render().problem).toBe('storage')
  expect(render().blocked).toBe(false)
  expect((await render().verify()).model).toBe('chosen-in-memory')
})
it('handles unsupported old hosts without an inference loop and requests refresh on configuration events', async () => {
  state.queryError = Error('Unknown method tasks.agentDefaults')
  state.results.clear()
  expect(render().unsupported).toBe(true)
  expect(render().blocked).toBe(false)
  expect(await render().verify()).toEqual(base)
  expect(state.invoke).not.toHaveBeenCalled()
  state.listeners.get('workspace:changed')!()
  expect(client.invalidateQueries).toHaveBeenCalled()
})

it('drops a cached repository model when a downgraded host no longer supports repository defaults', async () => {
  expect(render().settings.model).toBe('repo-model')
  state.queryError = Error('Unknown method tasks.agentDefaults')
  expect(render().settings.model).toBe('host-model')
  expect(await render().verify()).toEqual(base)
})

it('rejects a preflight superseded by a configuration event even before its refresh is rendered', async () => {
  let resolve!: (value: ProjectAgentDefaults) => void
  state.invoke.mockImplementation(
    () =>
      new Promise<ProjectAgentDefaults>((done) => {
        resolve = done
      }),
  )
  const pending = render().verify()
  state.listeners.get('workspace:changed')!()
  resolve(repository)
  await expect(pending).rejects.toThrow('Review the model')
  expect(state.updates).toEqual([])
})
