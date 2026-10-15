import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AppPreferences, ProviderCatalog, UsageReading } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS, DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { AgentService, type QueryFn } from '../src/agent'
import type { AgentRunnerFactory } from '../src/agent/agentRunner'
import { openDb, type Db } from '../src/db'
import { goalInstructions, goalPreferencesSchema, registerGoalTools } from '../src/agent/goals'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

let db: Db, service: AgentService, prefs: AppPreferences, id: string
let emit: (event: AgentEvent, limit?: boolean) => void
let prompts: string[]
let readings: UsageReading[]
const done = () => emit({ kind: 'result', isError: false, text: 'Turn ended', costUsd: null })
const tick = async (ms = 1000) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(async () => {
  vi.useFakeTimers()
  db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0); INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'Task', 'current', 'idle', 0)",
  )
  prefs = structuredClone(DEFAULT_APP_PREFERENCES)
  prompts = []
  readings = []
  const factory: AgentRunnerFactory = (_scope, _settings, callback) => {
    emit = callback
    return {
      start: async (prompt) => {
        prompts.push(prompt)
        callback({ kind: 'init', providerSessionId: 'thread', model: 'fake', cwd: '/tmp' })
        callback({ kind: 'state', state: 'running' })
      },
      send: async (prompt) => {
        prompts.push(prompt)
      },
      steer: async (prompt) => {
        prompts.push(prompt)
      },
      interrupt: async () => {},
      stop: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    }
  }
  service = new AgentService(
    db,
    () => {},
    (() => {
      throw new Error('Unexpected AI call')
    }) as QueryFn,
    factory,
  )
  service.preferences = () => prefs
  service.catalog = async () =>
    [
      {
        provider: 'codex',
        models: [{ id: 'fake', provider: 'codex', name: 'Fake', efforts: [], defaultEffort: null, isDefault: true }],
      },
    ] as ProviderCatalog[]
  const session = service.start('t', { cwd: '/tmp', covers: [], additionalDirs: [] }, 'Implement and verify login', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
    autoFallback: false,
  })
  id = session.id
  await tick(0)
})
afterEach(() => {
  service?.stopAll()
  db?.close()
  vi.useRealTimers()
})

describe('Ramu goals', () => {
  it('defaults to automatic detection and 10 extra turns, validates unlimited and custom limits', () => {
    expect(goalPreferencesSchema.parse({})).toEqual({ mode: 'auto', maxTurns: 10 })
    expect(goalPreferencesSchema.parse({ maxTurns: null }).maxTurns).toBeNull()
    expect(goalPreferencesSchema.parse({ mode: 'off', maxTurns: 25 })).toEqual({ mode: 'manual', maxTurns: 25 })
    for (const maxTurns of [0, -1, 1.5, 1001, Infinity])
      expect(() => goalPreferencesSchema.parse({ maxTurns })).toThrow()
  })

  it('detects through instructions at the start or later, without an interval AI judge', () => {
    const prompt = goalInstructions(prefs.goals, null)
    expect(prompt).toContain('at the start or later')
    expect(prompt).toContain('Inspect the task first before creating an implicit goal')
    expect(prompt).toContain('multiple steps or files, tests, a verifiable outcome')
    expect(prompt).toContain('do not by themselves justify a goal')
    expect(prompt).toContain('Do not require certainty')
    expect(prompt).toContain('an app-wide migration with staged implementation and UI verification')
    expect(prompt).toContain('when the scope grows')
    expect(prompt).toContain('audit ALL requirements')
    expect(goalInstructions({ mode: 'manual', maxTurns: 10 }, null)).toContain('explicitly requests')
  })

  it('continues idle unfinished work, keeps user history intact, and stops at the cap', async () => {
    prefs.goals.maxTurns = 2
    service.setGoal(id, 'Implement and verify login')
    done()
    await tick()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('Audit the latest user instructions')
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 1 })
    done()
    await tick()
    expect(prompts).toHaveLength(3)
    done()
    await tick()
    expect(prompts).toHaveLength(3)
    expect(service.getGoal(id)).toMatchObject({ status: 'turn-limit', turns: 2 })
    expect(service.events(id).filter((e) => e.kind === 'user')).toHaveLength(1)
    service.controlGoal(id, 'resume')
    await tick()
    expect(prompts).toHaveLength(4)
  })

  it('completed and blocked goals do not continue; a user reply can unblock', async () => {
    service.setGoal(id, 'Login works and tests pass')
    service.updateGoal(id, 'blocked', 'Need the authentication endpoint')
    done()
    await tick(10_000)
    expect(prompts).toHaveLength(1)
    await service.send(id, 'Use /api/auth')
    expect(service.getGoal(id)?.status).toBe('active')
    service.updateGoal(id, 'completed', 'Implemented login; authentication tests passed')
    done()
    await tick(10_000)
    expect(prompts).toHaveLength(2)
  })

  it('Stop cancels pending continuation and only the user can resume', async () => {
    service.setGoal(id, 'Implement login')
    done()
    service.stop(id)
    await tick(10_000)
    expect(service.getGoal(id)?.status).toBe('paused')
    expect(prompts).toHaveLength(1)
    expect(() => service.setGoal(id, 'Implement login')).toThrow('Only the user')
    expect(() => service.updateGoal(id, 'active', 'keep going')).toThrow('Only the user')
    service.controlGoal(id, 'resume')
    await tick()
    expect(prompts).toHaveLength(2)
  })

  it('queued user messages run before goal continuation', async () => {
    service.setGoal(id, 'Implement login')
    await service.submit(id, 'Also include logout', 'queue')
    done()
    await tick()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('Also include logout')
    expect(service.getGoal(id)?.turns).toBe(0)
    done()
    await tick()
    expect(prompts).toHaveLength(3)
  })

  it('raising a reached limit preserves accounting and allows more turns', async () => {
    prefs.goals.maxTurns = 1
    service.setGoal(id, 'Login')
    done()
    await tick()
    done()
    await tick()
    expect(service.getGoal(id)).toMatchObject({ status: 'turn-limit', turns: 1 })
    prefs.goals.maxTurns = 3
    service.goalsSettingsChanged()
    await tick()
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 2 })
  })

  it('preserves file context when /goal is set on an existing chat', async () => {
    done()
    await service.submit(id, '/goal Login\n\n<ramu-context>\nUnsaved auth.ts buffer\n</ramu-context>', 'queue')
    await tick()
    expect(service.getGoal(id)?.objective).toBe('Login')
    expect(prompts[1]).toContain('Unsaved auth.ts buffer')
    expect(prompts[1]).not.toMatch(/^\/goal/)
  })

  it('turning off automatic goals rejects implicit activation but keeps explicit goals and continuation', async () => {
    service.setGoal(id, 'Login')
    prefs.goals.mode = 'manual'
    service.goalsSettingsChanged()
    done()
    await tick()
    expect(prompts).toHaveLength(2)
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 1 })
    service.controlGoal(id, 'pause')
    service.controlGoal(id, 'resume')
    expect(service.getGoal(id)?.status).toBe('active')
    service.controlGoal(id, 'clear')
    expect(() => service.setGoal(id, 'Login')).toThrow('Manual mode')
    await service.submit(id, '/goal Login\n\n<ramu-context>\nfile context\n</ramu-context>', 'queue')
    expect(service.getGoal(id)?.objective).toBe('Login')
    done()
    await tick()
    done()
    await tick()
    expect(service.getGoal(id)?.turns).toBe(1)
    expect(prompts).toHaveLength(4)
  })

  it('unlimited exceeds the default cap and usage exhaustion waits, retries, and preserves the turn count', async () => {
    prefs.goals.maxTurns = null
    service.setGoal(id, 'Implement login')
    for (let n = 0; n < 12; n++) {
      done()
      await tick()
    }
    expect(service.getGoal(id)?.turns).toBe(12)
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)).toMatchObject({ status: 'waiting-provider', turns: 12 })
    expect(service.get(id).state).toBe('idle')
    const before = prompts.length
    await tick(59_000)
    expect(prompts).toHaveLength(before)
    await tick(1001)
    expect(prompts).toHaveLength(before + 1)
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 12 })
  })

  it('uses a known reset time and detects fresh provider availability without an AI call', async () => {
    const reset = Date.now() + 3600_000
    readings = [
      {
        provider: 'codex',
        window: 'five_hour',
        usedPercent: 100,
        status: 'limited',
        resetsAt: reset,
        updatedAt: Date.now(),
      },
    ]
    service.usage = {
      list: () => readings,
      update: (next) => {
        readings = next
      },
    }
    service.catalog = async () =>
      [
        {
          provider: 'codex',
          models: [{ id: 'fake', provider: 'codex', name: 'Fake', efforts: [], defaultEffort: null, isDefault: true }],
        },
      ] as ProviderCatalog[]
    service.setGoal(id, 'Login')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)?.retryAt).toBe(reset + 1000)
    await tick(1000)
    expect(prompts).toHaveLength(1)
    readings = [{ ...readings[0]!, status: 'ok', usedPercent: 0, updatedAt: Date.now() }]
    await tick(60_000)
    expect(prompts).toHaveLength(2)
  })

  it('does not spin when stale reset information is followed by another quota failure', async () => {
    readings = [
      {
        provider: 'codex',
        window: 'five_hour',
        usedPercent: 100,
        status: 'limited',
        resetsAt: Date.now() - 10_000,
        updatedAt: Date.now() - 20_000,
      },
    ]
    service.usage = {
      list: () => readings,
      update: (next) => {
        readings = next
      },
    }
    service.setGoal(id, 'Login')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    await tick(1000)
    expect(prompts).toHaveLength(1)
    await tick(59_001)
    expect(prompts).toHaveLength(2)
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    await tick(1000)
    expect(prompts).toHaveLength(2)
    expect(service.getGoal(id)?.retryDelay).toBe(120_000)
  })

  it('persists waiting goals through restart and Stop cancels retry', async () => {
    service.setGoal(id, 'Login')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    service.stopAll(true)
    const restarted = new AgentService(db, () => {}, (() => {
      throw new Error('Unexpected inference')
    }) as QueryFn)
    restarted.preferences = () => prefs
    restarted.markRestoredOnBoot()
    expect(restarted.getGoal(id)).toMatchObject({ status: 'waiting-provider', objective: 'Login' })
    restarted.goalsSettingsChanged()
    restarted.stop(id)
    await tick(120_000)
    expect(restarted.getGoal(id)?.status).toBe('paused')
    restarted.stopAll()
  })

  it('registers provider-neutral goal tools and reports tool errors without throwing', () => {
    const calls = new Map<string, (args: any) => any>()
    const descriptions = new Map<string, string>()
    registerGoalTools(
      {
        registerTool: (name: string, schema: { description: string }, call: (args: any) => any) => {
          calls.set(name, call)
          descriptions.set(name, schema.description)
        },
      } as unknown as McpServer,
      service,
      id,
    )
    expect([...calls.keys()]).toEqual(['set_goal', 'get_goal', 'update_goal'])
    expect(descriptions.get('set_goal')).toContain('Inspect the task first before creating an implicit goal')
    expect(descriptions.get('set_goal')).toContain('do not by themselves justify a goal')
    expect(calls.get('set_goal')!({ objective: 'Check a timestamp' }).isError).toBe(true)
    expect(service.getGoal(id)).toBeNull()
    expect(
      calls.get('set_goal')!({
        objective: 'Login',
        continuationReason: 'User explicitly requested: create a goal to implement login.',
      }).isError,
    ).toBeUndefined()
    expect(calls.get('update_goal')!({ status: 'completed', reason: 'Tests pass' }).isError).toBeUndefined()
    expect(calls.get('update_goal')!({ status: 'active', reason: 'Restart' }).isError).toBe(true)
  })
})
