import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
