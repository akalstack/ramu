import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentProvider,
  type AgentSettings,
  type UsageReading,
  type ProviderCatalog,
} from '@ramu/shared/types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { AgentService, type QueryFn } from '../src/agent'
import type { AgentRunnerFactory, ProviderRunners } from '../src/agent/agentRunner'
import { FallbackRouter, type FallbackRouterHost } from '../src/agent/fallbackRouter'
import { UsageService } from '../src/providers/usage'
import { openDb, type Db } from '../src/db'

const catalogs: ProviderCatalog[] = AGENT_PROVIDERS.map((provider) => ({
  provider,
  models: [{ provider, id: 'main', name: 'Main', isDefault: true, efforts: ['high'], defaultEffort: 'high' }],
}))
const prefs = {
  ...DEFAULT_APP_PREFERENCES,
  providerBinaries: Object.fromEntries(
    AGENT_PROVIDERS.map((provider) => [
      provider,
      { binary: '', accountId: 'default', accounts: [{ id: 'b', name: 'Second' }] },
    ]),
  ),
}
const settings = (provider: AgentProvider): AgentSettings => ({
  ...DEFAULT_AGENT_SETTINGS,
  provider,
  model: 'main',
  accountId: 'default',
  effort: 'high',
  autoFallback: true,
})
const reading = (provider: AgentProvider, accountId = 'default', usedPercent = 100): UsageReading => ({
  provider,
  ...(accountId !== 'default' ? { accountId } : {}),
  window: 'five_hour',
  usedPercent,
  status: usedPercent >= 100 ? 'limited' : 'ok',
  updatedAt: Date.now(),
  resetsAt: Date.now() + 3600000,
})
let db: Db
let cwd: string
let service: AgentService | undefined
beforeEach(() => {
  db = openDb(':memory:')
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-account-routing-')))
  db.exec(`INSERT INTO projects (id,name,created_at) VALUES ('p','P',0);
    INSERT INTO tasks (id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',0);`)
})
afterEach(() => {
  service?.stopAll()
  service = undefined
  db.close()
  rmSync(cwd, { recursive: true, force: true })
})

it.each(AGENT_PROVIDERS)(
  '%s routes a new request to another account before another model and refreshes its readings',
  async (provider) => {
    const usage = new UsageService(
      () => [reading(provider), reading(provider, 'b', 100)],
      () => {},
      () => {},
    )
    const refresh = vi.fn(async () => {
      usage.update([reading(provider, 'b', 3)])
    })
    const host = {
      preferencesSource: () => () => prefs,
      preferences: () => prefs,
      usage: () => usage,
      catalog: async () => catalogs,
      refreshAccountUsage: () => refresh,
    } as unknown as FallbackRouterHost
    const router = new FallbackRouter(host, db)
    const route = await router.route(settings(provider))
    expect(refresh).toHaveBeenCalledWith(provider)
    expect(route?.step).toMatchObject({ provider, model: 'main', accountId: 'b', effort: 'high' })
    expect(router.withStep(settings(provider), route!.step)).toMatchObject({
      provider,
      model: 'main',
      accountId: 'b',
      effort: 'high',
    })
  },
)

it('background analysis rotates accounts after a runtime limit before switching providers', async () => {
  const runs: AgentSettings[] = []
  const factory: AgentRunnerFactory = (_scope, current, emit) => ({
    start: async () => {
      runs.push(current)
      if (current.accountId === 'default')
        emit({ kind: 'result', text: 'usage_limit_reached', isError: true, costUsd: null }, true)
      else {
        emit({ kind: 'text', text: 'Finished with the second account' })
        emit({ kind: 'result', text: 'done', isError: false, costUsd: null })
      }
    },
    send: async () => {},
    steer: async () => {},
    interrupt: async () => {},
    stop: async () => {},
    replyPermission() {},
    replyQuestion() {},
  })
  const noQuery: QueryFn = () => {
    throw new Error('Unexpected provider query')
  }
  service = new AgentService(db, () => {}, noQuery, { cursor: factory } satisfies ProviderRunners)
  vi.spyOn(service, 'catalog').mockResolvedValue(catalogs)
  service.preferences = () => prefs
  service.usage = new UsageService(
    () => [reading('cursor', 'b', 3)],
    () => {},
    () => {},
  )
  service.refreshAccountUsage = vi.fn(async () => {})
  const result = await service.analyze('Finish the task', settings('cursor'))
  expect(result.message).toBe('Finished with the second account')
  expect(runs.map((s) => [s.provider, s.accountId])).toEqual([
    ['cursor', 'default'],
    ['cursor', 'b'],
  ])
})

it('switches an existing thread account before sending and preserves the conversation and effort', async () => {
  const runs: { accountId?: string; prompt: string }[] = []
  const factory: AgentRunnerFactory = (_scope, current, emit) => {
    const run = async (prompt: string) => {
      runs.push({ accountId: current.accountId, prompt })
      emit({ kind: 'text', text: 'Done' })
      emit({ kind: 'result', text: 'Done', isError: false, costUsd: null })
    }
    return {
      start: run,
      send: run,
      steer: run,
      interrupt: async () => {},
      stop: async () => {},
      replyPermission() {},
      replyQuestion() {},
    }
  }
  service = new AgentService(
    db,
    () => {},
    () => {
      throw new Error('Unexpected Claude query')
    },
    { cursor: factory },
  )
  vi.spyOn(service, 'catalog').mockResolvedValue(catalogs)
  service.preferences = () => prefs
  const usage = new UsageService(
    () => [],
    () => {},
    () => {},
  )
  service.usage = usage
  const s = await service.startReviewed(
    't',
    { cwd, additionalDirs: [], covers: [cwd] },
    'Remember the previous work',
    settings('cursor'),
  )
  const idle = async () => {
    for (let i = 0; i < 200; i++) {
      if (service!.get(s.id).state === 'idle') return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Thread did not finish')
  }
  await idle()
  usage.update([reading('cursor'), reading('cursor', 'b', 3)])
  await service.send(s.id, 'Continue the work')
  await idle()
  expect(service.get(s.id).settings).toMatchObject({
    provider: 'cursor',
    model: 'main',
    accountId: 'b',
    effort: 'high',
  })
  expect(runs.map((r) => r.accountId)).toEqual(['default', 'b'])
  expect(runs[1]!.prompt).toContain('Continue the work')
  expect(service.events(s.id).filter((event) => event.kind === 'user')).toHaveLength(2)
})

it('routes helpers through another parent-provider account before moving to another model', async () => {
  const usage = new UsageService(
    () => [reading('claude-code'), reading('claude-code', 'b', 3)],
    () => {},
    () => {},
  )
  const host = {
    get: () => ({ provider: 'claude-code', settings: settings('claude-code') }),
    preferencesSource: () => () => prefs,
    preferences: () => prefs,
    usage: () => usage,
    catalog: async () => catalogs,
  } as unknown as FallbackRouterHost
  const result = await new FallbackRouter(host, db).subagentSettings('parent')
  expect(result.settings).toMatchObject({ provider: 'claude-code', model: 'main', accountId: 'b', effort: 'high' })
  expect(result.redirect).toBe(true)
})

it('retries a held thread when another account gains capacity, while its current account stays limited', async () => {
  const runs: string[] = []
  const factory: AgentRunnerFactory = (_scope, current, emit) => ({
    start: async () => {
      runs.push(current.accountId ?? 'default')
      if (current.accountId !== 'b')
        emit({ kind: 'result', text: 'Provider rejected this request', isError: true, costUsd: null }, true)
      else {
        emit({ kind: 'text', text: 'Done' })
        emit({ kind: 'result', text: 'Done', isError: false, costUsd: null })
      }
    },
    send: async () => {},
    steer: async () => {},
    interrupt: async () => {},
    stop: async () => {},
    replyPermission() {},
    replyQuestion() {},
  })
  service = new AgentService(
    db,
    () => {},
    () => {
      throw new Error('Unexpected Claude query')
    },
    { cursor: factory },
  )
  vi.spyOn(service, 'catalog').mockResolvedValue(catalogs)
  service.preferences = () => ({ ...prefs, fallback: { ...prefs.fallback, order: [] } })
  const usage = new UsageService(
    () => [reading('cursor'), reading('cursor', 'b')],
    () => {},
    () => {},
  )
  service.usage = usage
  const s = service.start('t', { cwd, additionalDirs: [], covers: [cwd] }, 'Keep working', settings('cursor'))
  for (let i = 0; i < 200 && !service.providerWait(s.id); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(service.providerWait(s.id)).not.toBeNull()
  usage.update([reading('cursor', 'b', 3)])
  const result = await service.retryLimitNow(s.id)
  expect(result.resumed).toBe(true)
  for (let i = 0; i < 200 && service.get(s.id).state !== 'idle'; i++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  expect(service.get(s.id).settings.accountId).toBe('b')
  expect(runs).toEqual(['default', 'b'])
})

it('previews the next message route without switching, fetching or clearing a hold', async () => {
  const factory: AgentRunnerFactory = (_scope, _current, emit) => ({
    start: async () => {
      emit({ kind: 'result', text: 'Done', isError: false, costUsd: null })
    },
    send: async () => {},
    steer: async () => {},
    interrupt: async () => {},
    stop: async () => {},
    replyPermission() {},
    replyQuestion() {},
  })
  service = new AgentService(
    db,
    () => {},
    () => {
      throw new Error('Unexpected Claude query')
    },
    { cursor: factory },
  )
  vi.spyOn(service, 'catalog').mockResolvedValue(catalogs)
  const s = await service.startReviewed('t', { cwd, additionalDirs: [], covers: [cwd] }, 'Start', settings('cursor'))
  // Before preferences exist the host cannot say where the message would run.
  expect(await service.nextRoute(s.id)).toEqual({ state: 'unknown' })

  service.preferences = () => prefs
  const usage = new UsageService(
    () => [],
    () => {},
    () => {},
  )
  service.usage = usage
  const refresh = vi.fn(async () => {})
  service.refreshAccountUsage = refresh
  expect(await service.nextRoute(s.id)).toEqual({ state: 'stays' })

  usage.update([reading('cursor'), reading('cursor', 'b', 3)])
  expect(await service.nextRoute(s.id)).toMatchObject({
    state: 'switch',
    provider: 'cursor',
    accountId: 'b',
    held: null,
  })

  service.holdProvider(s.id, 'message')
  expect(await service.nextRoute(s.id)).toMatchObject({ state: 'switch', accountId: 'b', held: 'message' })
  expect(service.providerHold(s.id)).toBe('message')
  expect(service.get(s.id).settings.accountId).toBe('default')
  expect(refresh).not.toHaveBeenCalled()
})

it('prefers a login that already has the thread’s Shared MCP access, and falls back to the first when none does', async () => {
  const provider: AgentProvider = 'claude-code'
  const withAccounts = {
    ...prefs,
    providerBinaries: {
      ...prefs.providerBinaries,
      [provider]: {
        binary: '',
        accountId: 'default',
        accounts: [
          { id: 'b', name: 'Second' },
          { id: 'c', name: 'Third' },
        ],
      },
    },
  }
  const usage = new UsageService(
    () => [reading(provider), reading(provider, 'b', 3), reading(provider, 'c', 3)],
    () => {},
    () => {},
  )
  const lacking = new Set(['b'])
  const checked: (string | undefined)[] = []
  const host = {
    preferencesSource: () => () => withAccounts,
    preferences: () => withAccounts,
    usage: () => usage,
    catalog: async () => catalogs,
    refreshAccountUsage: () => async () => {},
    mcpDestination: () => async (_session: unknown, next: AgentSettings) => {
      checked.push(next.accountId)
      return lacking.has(next.accountId ?? '') ? [{ name: 'Tracker', status: 'approval-needed' }] : []
    },
  } as unknown as FallbackRouterHost
  const router = new FallbackRouter(host, db)
  const session = { provider, settings: settings(provider) } as never
  const pick = () =>
    (
      router as unknown as {
        readyAccount: (...args: unknown[]) => Promise<{ account: string; attention: unknown[] } | null>
      }
    ).readyAccount(session, router.routing(settings(provider)), catalogs, 80, new Set(['claude-code:default']))
  // B lacks the connection, C has it: C is chosen even though B comes first.
  const ready = await pick()
  expect(ready?.account).toBe('c')
  expect(ready?.attention).toEqual([])
  expect(checked).toEqual(['b', 'c'])
  // When every candidate lacks it, the first is used and still carries the notice.
  lacking.add('c')
  const none = await pick()
  expect(none?.account).toBe('b')
  expect(none?.attention).toEqual([{ name: 'Tracker', status: 'approval-needed' }])
})

it('pauses a limit fallback instead of moving a thread onto a login that would lose a connection it already used', async () => {
  const provider: AgentProvider = 'claude-code'
  const usage = new UsageService(
    () => [reading(provider), reading(provider, 'b', 3)],
    () => {},
    () => {},
  )
  const events: unknown[] = []
  const states: string[] = []
  const toolName = (id: string) =>
    `mcp__shared_mcp__Tracker-${createHash('sha256').update(id).digest('hex').slice(0, 6)}__create`
  const history = [{ kind: 'tool-use', name: toolName('conn-1') }]
  let launched = 0
  const attention = [{ name: 'Tracker', status: 'approval-needed', connectionId: 'conn-1' }]
  const host = {
    preferencesSource: () => () => prefs,
    preferences: () => prefs,
    usage: () => usage,
    catalog: async () => catalogs,
    refreshAccountUsage: () => async () => {},
    mcpDestination: () => async () => attention,
    get: () => ({ id: 's', provider, settings: settings(provider), state: 'running' }),
    events: () => history,
    transitioning: new Set<string>(),
    revisions: new Map<string, number>(),
    draining: new Map<string, Promise<void>>(),
    shutdown: () => false,
    catalogReady: true,
    planSwitch: () => ({ resume: null, info: { cause: 'limit', mode: 'full', fromSeq: 1 }, fits: true }),
    halt: () => {},
    record: (_id: string, event: unknown) => events.push(event),
    setState: (_id: string, state: string) => states.push(state),
    launch: () => void launched++,
    rememberSession: () => {},
    setupOmissions: () => () => [],
    settleChild: () => {},
    waitForGoalProvider: () => false,
    fail: () => {},
  } as unknown as FallbackRouterHost
  const router = new FallbackRouter(host, db)
  await router.fallback('s', 'high')
  expect(launched).toBe(0)
  expect(states.at(-1)).toBe('failed')
  expect(events).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining('Tracker') })])
  expect(JSON.stringify(events)).not.toMatch(/usage limit|quota/i)

  // A connection this thread never called does not stop the fallback; the switch carries the notice as before.
  history.length = 0
  events.length = 0
  states.length = 0
  await router.fallback('s', 'high')
  expect(launched).toBe(1)
  expect(events[0]).toMatchObject({ kind: 'settings', mcpAttention: attention })
})
