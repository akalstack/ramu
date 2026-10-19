import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AppPreferences, GoalEvidence, ProviderCatalog, UsageReading } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS, DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { AgentService, type QueryFn } from '../src/agent'
import type { AgentRunnerFactory } from '../src/agent/agentRunner'
import { openDb, type Db } from '../src/db'
import { turnActivity } from '../src/agent/goalEvidence'
import { goalInstructions, goalPreferencesSchema, goalState, registerGoalTools } from '../src/agent/goals'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { VerifyResult, WorkspaceSnapshot } from '../src/agent/goalProbes'

let db: Db, service: AgentService, prefs: AppPreferences, id: string
let emit: (event: AgentEvent, limit?: boolean) => void
let prompts: string[]
let readings: UsageReading[]
// What the stubbed git and shell report: the uncommitted files, and how the verification command ends.
let snapshot: WorkspaceSnapshot | null
let verifyResult: Promise<VerifyResult> | VerifyResult
let verifyCalls: { cwd: string; command: string; signal: AbortSignal }[]
const evidence: GoalEvidence = { checks: [{ name: 'pnpm test', passed: true, output: '12 passed' }], changedFiles: [] }
const pass: VerifyResult = { ok: true, code: 0, timedOut: false, output: 'all passed' }
let step = 0
/** A turn that ran something new, so continuations are not mistaken for a stall. */
const work = () => emit({ kind: 'tool-use', toolUseId: `tool-${step}`, name: 'shell', summary: `step ${step++}` })
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
  snapshot = null
  verifyResult = pass
  verifyCalls = []
  step = 0
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
  service.goalProbes = {
    snapshot: async () => snapshot,
    verify: async (cwd, command, signal) => {
      verifyCalls.push({ cwd, command, signal })
      return verifyResult
    },
  }
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

  it('gives a manual-mode thread the goal policy once, when /goal starts a goal mid-thread', async () => {
    prefs.goals.mode = 'manual'
    const connection: { url: string; token: string; instructions?: string } = {
      url: 'http://127.0.0.1:9/mcp',
      token: 't',
    }
    service.toolConnection = () => connection
    const manual = service.start('t', { cwd: '/tmp', covers: [], additionalDirs: [] }, 'Explain login', {
      ...DEFAULT_AGENT_SETTINGS,
      provider: 'codex',
      autoFallback: false,
    }).id
    await tick(0)
    expect(connection.instructions).not.toContain('Ramu owns goals')
    done()
    await tick()
    const before = prompts.length
    await service.send(manual, '/goal Fix login')
    await tick()
    expect(prompts.slice(before).join('\n')).toContain('Ramu owns goals')
    const sent = prompts.length
    done()
    await tick()
    expect(prompts.length).toBeGreaterThan(sent)
    expect(prompts.slice(sent).join('\n')).not.toContain('Ramu owns goals')
    expect(prompts.at(-1)).toContain(goalState(service.getGoal(manual)).slice(0, 20))
  })

  it('keeps the goal and question settings a chat launched with until it launches again', async () => {
    service.toolConnection = () => ({ url: 'http://127.0.0.1:9/mcp', token: 't' })
    const fresh = service.start('t', { cwd: '/tmp-pinned', covers: [], additionalDirs: [] }, 'Explain login', {
      ...DEFAULT_AGENT_SETTINGS,
      provider: 'codex',
      autoFallback: false,
    }).id
    await tick(0)
    done()
    await tick()
    prefs.goals.mode = 'manual'
    prefs.asyncQuestions = false
    await service.send(fresh, 'Settings changed')
    expect(service.launchSettings(fresh)).toEqual({ asyncQuestions: true, goalMode: 'auto' })
    const stopped = service.stopAndWait(fresh)
    await tick()
    await stopped
    await service.send(fresh, 'Back after the process ended')
    await tick()
    expect(service.launchSettings(fresh)).toEqual({ asyncQuestions: false, goalMode: 'manual' })
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
    await service.updateGoal(id, 'blocked', 'Need the authentication endpoint')
    done()
    await tick(10_000)
    expect(prompts).toHaveLength(1)
    await service.send(id, 'Use /api/auth')
    expect(service.getGoal(id)?.status).toBe('active')
    await service.updateGoal(id, 'completed', 'Implemented login; authentication tests passed', evidence)
    done()
    await tick(10_000)
    expect(prompts).toHaveLength(2)
  })

  it('Stop cancels pending continuation and only the user can resume', async () => {
    service.setGoal(id, 'Implement login')
    done()
    service.stop(id)
    await tick(10_000)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'user' })
    expect(prompts).toHaveLength(1)
    expect(() => service.setGoal(id, 'Implement login')).toThrow('Only the user')
    await expect(service.updateGoal(id, 'active', 'keep going')).rejects.toThrow('Only the user')
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

  it('preserves file context when /goal is set on an existing thread', async () => {
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
      work()
      done()
      await tick()
    }
    expect(service.getGoal(id)?.turns).toBe(12)
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'provider-limit', turns: 12 })
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
    expect(restarted.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'provider-limit', objective: 'Login' })
    restarted.goalsSettingsChanged()
    restarted.stop(id)
    await tick(120_000)
    // Stop is the user's pause: it replaces the limit hold and never resumes by itself.
    expect(restarted.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'user' })
    restarted.stopAll()
  })

  it('keeps a limit hold and a user pause apart: the hold resumes by itself, the pause never does', async () => {
    service.setGoal(id, 'Login')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'provider-limit' })
    // Pausing a held goal makes it the user's, and the retry timer no longer continues it.
    service.controlGoal(id, 'pause')
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'user' })
    const before = prompts.length
    await tick(10 * 60_000)
    expect(prompts).toHaveLength(before)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'user' })
    // Resuming clears the holder, so the goal is plain active again.
    service.controlGoal(id, 'resume')
    expect(service.getGoal(id)?.status).toBe('active')
    expect(service.getGoal(id)?.pausedBy).toBeUndefined()
  })

  it('does not turn a goal the user paused into a limit hold when its thread reaches a limit', async () => {
    service.setGoal(id, 'Login')
    service.controlGoal(id, 'pause')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'user' })
  })

  it('clears the limit hold when the retry goes out and never writes the retired status', async () => {
    service.setGoal(id, 'Login')
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    await tick(61_000)
    expect(service.getGoal(id)?.status).toBe('active')
    expect(service.getGoal(id)?.pausedBy).toBeUndefined()
    const statuses = (
      db.prepare("SELECT event FROM agent_events WHERE json_extract(event, '$.kind') = 'goal'").all() as {
        event: string
      }[]
    ).map((row) => JSON.parse(row.event).goal?.status)
    expect(statuses).toContain('paused')
    expect(statuses).not.toContain('waiting-provider')
  })

  it('reads a goal an older host or release saved as waiting-provider as a limit hold', async () => {
    service.setGoal(id, 'Login')
    const goal = service.getGoal(id)!
    // What a release before the merge would have written for a goal at a limit.
    db.prepare(
      'INSERT INTO agent_events (session_id, seq, event) VALUES (?, (SELECT MAX(seq) + 1 FROM agent_events WHERE session_id = ?), ?)',
    ).run(
      id,
      id,
      JSON.stringify({ kind: 'goal', goal: { ...goal, status: 'waiting-provider', retryAt: Date.now() + 60_000 } }),
    )
    const raw = db
      .prepare("SELECT event FROM agent_events WHERE json_extract(event, '$.kind') = 'goal' ORDER BY seq DESC LIMIT 1")
      .get() as { event: string }
    expect(JSON.parse(raw.event).goal.status).toBe('waiting-provider')
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'provider-limit' })
  })

  it('registers provider-neutral goal tools and reports tool errors without throwing', async () => {
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
    expect((await calls.get('set_goal')!({ objective: 'Check a timestamp' })).isError).toBe(true)
    expect(service.getGoal(id)).toBeNull()
    expect(
      (
        await calls.get('set_goal')!({
          objective: 'Login',
          continuationReason: 'User explicitly requested: create a goal to implement login.',
        })
      ).isError,
    ).toBeUndefined()
    // Completion without evidence is an error the agent can read and fix.
    const refused = await calls.get('update_goal')!({ status: 'completed', reason: 'Tests pass' })
    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toContain('needs evidence')
    expect(descriptions.get('update_goal')).toContain('evidence.checks')
    expect(
      (await calls.get('update_goal')!({ status: 'completed', reason: 'Tests pass', evidence })).isError,
    ).toBeUndefined()
    expect((await calls.get('update_goal')!({ status: 'active', reason: 'Restart' })).isError).toBe(true)
  })
})

describe('goal completion evidence', () => {
  it('rejects a completion claim with no evidence, no checks, or a failed check', async () => {
    service.setGoal(id, 'Login works')
    await expect(service.updateGoal(id, 'completed', 'All done')).rejects.toThrow('needs evidence')
    await expect(
      service.updateGoal(id, 'completed', 'All done', { checks: [], changedFiles: ['auth.ts'] }),
    ).rejects.toThrow('needs evidence')
    await expect(
      service.updateGoal(id, 'completed', 'All done', {
        checks: [
          { name: 'pnpm test', passed: true },
          { name: 'pnpm typecheck', passed: false, output: '2 errors' },
        ],
        changedFiles: [],
      }),
    ).rejects.toThrow('pnpm typecheck')
    expect(service.getGoal(id)?.status).toBe('active')
    expect(await service.updateGoal(id, 'completed', 'All done', evidence)).toMatchObject({
      status: 'completed',
      evidence,
    })
  })

  it.each(['objective', 'verify', 'instructions', 'pause'] as const)(
    'rejects completion when %s changes while workspace evidence is checked',
    async (change) => {
      service.setGoal(id, 'Login works', true)
      await tick(0)
      let resolve!: (value: WorkspaceSnapshot | null) => void
      service.goalProbes.snapshot = () =>
        new Promise((ready) => {
          resolve = ready
        })
      const completion = service.updateGoal(id, 'completed', 'Login passed', evidence)
      const rejected = expect(completion).rejects.toThrow('goal changed')
      if (change === 'objective') service.setGoal(id, 'Login AND logout work', true)
      if (change === 'verify') service.setVerify(id, 'pnpm test:logout')
      if (change === 'instructions') await service.submit(id, 'Also cover logout', 'queue')
      if (change === 'pause') service.controlGoal(id, 'pause')
      resolve(null)
      await rejected
      expect(service.getGoal(id)?.status).not.toBe('completed')
      expect(service.getGoal(id)?.claim).toBeUndefined()
    },
  )

  it('rejects a claim when a required question arrives during evidence validation', async () => {
    service.setGoal(id, 'Login works', true)
    await tick(0)
    let resolve!: (value: WorkspaceSnapshot | null) => void
    service.goalProbes.snapshot = () =>
      new Promise((ready) => {
        resolve = ready
      })
    const completion = service.updateGoal(id, 'completed', 'Done', evidence)
    const rejected = expect(completion).rejects.toThrow('goal changed')
    emit({
      kind: 'question',
      requestId: 'q1',
      questions: [{ question: 'Which login?', header: 'Login', options: [], multiSelect: false }],
    })
    resolve(null)
    await rejected
    expect(service.getGoal(id)?.status).toBe('active')
  })

  it('rejects completion when a question draft changes in place during validation', async () => {
    service.setGoal(id, 'Login works', true)
    await tick(0)
    emit({
      kind: 'question',
      requestId: 'draft-q',
      responseMode: 'message',
      questions: [{ question: 'Which account?', header: 'Account', options: [], multiSelect: false }],
    })
    emit({ kind: 'question-state', requestId: 'draft-q', drafts: { Account: 'First account' } })
    let resolve!: (value: WorkspaceSnapshot | null) => void
    service.goalProbes.snapshot = () =>
      new Promise((ready) => {
        resolve = ready
      })
    const completion = service.updateGoal(id, 'completed', 'Done', evidence)
    const rejected = expect(completion).rejects.toThrow('goal changed')
    emit({ kind: 'question-state', requestId: 'draft-q', drafts: { Account: 'Second account' } })
    resolve(null)
    await rejected
    expect(service.getGoal(id)?.status).toBe('active')
  })

  it.each([pass, { ok: false, code: 1, timedOut: false, output: 'Old failure' }])(
    'does not settle an older verification after a replacement claim (%j)',
    async (oldResult) => {
      service.setGoal(id, 'Login works', true, 'pnpm test')
      await service.updateGoal(id, 'completed', 'Old claim', evidence)
      let resolve!: (value: VerifyResult) => void
      verifyResult = new Promise((ready) => {
        resolve = ready
      })
      done()
      await tick()
      expect(verifyCalls).toHaveLength(1)
      await service.updateGoal(id, 'completed', 'Replacement claim', evidence)
      expect(verifyCalls[0]!.signal.aborted).toBe(true)
      resolve(oldResult)
      await tick(0)
      expect(service.getGoal(id)).toMatchObject({ status: 'active', claim: { reason: 'Replacement claim' } })
      expect(service.getGoal(id)?.check).toBeUndefined()
      verifyResult = pass
      await tick()
      expect(service.getGoal(id)).toMatchObject({ status: 'completed', evidence })
      expect(service.getGoal(id)?.reason).toContain('Replacement claim')
      expect(verifyCalls).toHaveLength(2)
    },
  )

  it.each(['objective', 'verify'] as const)('discards a verification when its %s changes', async (change) => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Done', evidence)
    let resolve!: (value: VerifyResult) => void
    verifyResult = new Promise((ready) => {
      resolve = ready
    })
    done()
    await tick()
    if (change === 'objective') service.setGoal(id, 'Login AND logout work', true)
    else service.setVerify(id, 'pnpm test:logout')
    expect(verifyCalls[0]!.signal.aborted).toBe(true)
    resolve(pass)
    await tick(0)
    expect(service.getGoal(id)).toMatchObject({ status: 'active' })
    expect(service.getGoal(id)?.claim).toBeUndefined()
    expect(service.getGoal(id)?.check).toBeUndefined()
  })

  it.each(['before', 'during'] as const)(
    'requires fresh evidence for instructions arriving %s verification',
    async (when) => {
      service.setGoal(id, 'Login works', true, 'pnpm test')
      await service.updateGoal(id, 'completed', 'Done', evidence)
      let resolve!: (value: VerifyResult) => void
      verifyResult = new Promise((ready) => {
        resolve = ready
      })
      if (when === 'before') await service.submit(id, 'Also cover logout', 'queue')
      done()
      await tick()
      if (when === 'during') {
        expect(verifyCalls).toHaveLength(1)
        await service.submit(id, 'Also cover logout', 'queue')
        resolve(pass)
        await tick(0)
      }
      done()
      await tick()
      expect(service.getGoal(id)?.status).toBe('active')
      expect(service.getGoal(id)?.claim).toBeUndefined()
      expect(service.getGoal(id)?.check).toBeUndefined()
    },
  )

  it('does not ask for evidence when the goal stays active or is blocked', async () => {
    service.setGoal(id, 'Login works')
    expect(await service.updateGoal(id, 'active', 'Two files left')).toMatchObject({ status: 'active' })
    expect(await service.updateGoal(id, 'blocked', 'Need the endpoint')).toMatchObject({ status: 'blocked' })
  })

  it('requires every uncommitted change made during the goal to be accounted for, and no others', async () => {
    snapshot = { root: '/repo', files: { 'notes.md': 'user-draft' } }
    service.setGoal(id, 'Login works')
    await tick(0)
    snapshot = { root: '/repo', files: { 'notes.md': 'user-draft', 'src/auth.ts': 'h1', 'src/auth.test.ts': 'h2' } }
    // notes.md was already dirty and has not changed since, so the goal is not answerable for it.
    await expect(
      service.updateGoal(id, 'completed', 'Done', { ...evidence, changedFiles: ['src/auth.ts'] }),
    ).rejects.toThrow(/uncommitted changes.*src\/auth\.test\.ts/)
    await expect(service.updateGoal(id, 'completed', 'Done', evidence)).rejects.toThrow(/src\/auth\.ts/)
    // Relative, absolute and directory mentions all count, and so does a file that is not the agent's.
    expect(
      await service.updateGoal(id, 'completed', 'Done', {
        ...evidence,
        changedFiles: ['/repo/src/auth.ts'],
        otherChanges: ['src/'],
      }),
    ).toMatchObject({ status: 'completed' })
  })

  it('notices a file that was already dirty and changed again during the goal', async () => {
    snapshot = { root: '/repo', files: { 'notes.md': 'v1' } }
    service.setGoal(id, 'Login works')
    await tick(0)
    snapshot = { root: '/repo', files: { 'notes.md': 'v2' } }
    await expect(service.updateGoal(id, 'completed', 'Done', evidence)).rejects.toThrow(/notes\.md/)
  })

  it('skips the workspace check outside a git repository or when no baseline was taken', async () => {
    service.setGoal(id, 'Login works')
    await tick(0)
    snapshot = { root: '/repo', files: { 'src/auth.ts': 'h1' } }
    // The baseline was taken while the probe reported no repository, so there is nothing to compare with.
    expect(await service.updateGoal(id, 'completed', 'Done', evidence)).toMatchObject({ status: 'completed' })
  })
})

describe('goal verification command', () => {
  it('runs after the turn ends, completes only on a pass, and records the check', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    const claimed = await service.updateGoal(id, 'completed', 'Implemented login', evidence)
    expect(claimed).toMatchObject({ status: 'active', claim: { reason: 'Implemented login' } })
    // The agent is still in its turn: nothing runs yet.
    await tick(5000)
    expect(verifyCalls).toHaveLength(0)
    done()
    await tick()
    expect(verifyCalls).toEqual([{ cwd: '/tmp', command: 'pnpm test', signal: expect.any(AbortSignal) }])
    const goal = service.getGoal(id)!
    expect(goal).toMatchObject({ status: 'completed', evidence, check: { command: 'pnpm test', ok: true } })
    expect(goal.claim).toBeUndefined()
    expect(goal.reason).toContain('Verified: `pnpm test` passed.')
    expect(prompts).toHaveLength(1)
  })

  it('returns a failure to the agent as the next continuation, once, and counts it as a turn', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Implemented login', evidence)
    verifyResult = { ok: false, code: 1, timedOut: false, output: 'FAIL login.test.ts\nexpected 200, got 500' }
    done()
    await tick()
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 0, check: { ok: false, code: 1 } })
    expect(service.getGoal(id)?.reason).toContain('Verification failed')
    await tick()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('verification command')
    expect(prompts[1]).toContain('expected 200, got 500')
    expect(prompts[1]).toContain('exited with code 1')
    expect(service.getGoal(id)).toMatchObject({ status: 'active', turns: 1, check: { ok: false, delivered: true } })
    // The next continuation does not repeat it.
    work()
    done()
    await tick()
    expect(prompts[2]).not.toContain('expected 200, got 500')
    // And a later claim that passes completes the goal.
    verifyResult = pass
    await service.updateGoal(id, 'completed', 'Fixed', evidence)
    done()
    await tick()
    expect(service.getGoal(id)).toMatchObject({ status: 'completed', check: { ok: true } })
  })

  it('removes credentials from the output and bounds its size', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Done', evidence)
    verifyResult = {
      ok: false,
      code: 2,
      timedOut: false,
      output: `${'x'.repeat(9000)}\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY\nlast line`,
    }
    done()
    await tick()
    const output = service.getGoal(id)!.check!.output
    expect(output).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY')
    expect(output).toContain('[redacted]')
    expect(output).toContain('last line')
    expect(output.length).toBeLessThan(4200)
  })

  it('treats a timeout as a failure', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Done', evidence)
    verifyResult = { ok: false, code: null, timedOut: true, output: '' }
    done()
    await tick()
    expect(service.getGoal(id)?.check?.output).toContain('timed out')
    expect(service.getGoal(id)?.check).toMatchObject({ code: null, timedOut: true })
  })

  it('is set only by the user: the agent cannot give a goal a command to run', async () => {
    service.setGoal(id, 'Login works', false, 'rm -rf /')
    expect(service.getGoal(id)?.verify).toBeUndefined()
    // A refinement by the agent keeps the user's command.
    service.setGoal(id, 'Login works', true, 'pnpm test')
    service.setGoal(id, 'Login and logout work', false, 'echo pwned')
    expect(service.getGoal(id)).toMatchObject({ objective: 'Login and logout work', verify: 'pnpm test' })
  })

  it('reads /goal verify: and a trailing verify line, and removes the command with off', async () => {
    done()
    await service.submit(id, '/goal Login works\nverify: pnpm --filter @ramu/server test', 'queue')
    expect(service.getGoal(id)).toMatchObject({
      objective: 'Login works',
      verify: 'pnpm --filter @ramu/server test',
    })
    await service.submit(id, '/goal verify: pnpm typecheck', 'queue')
    expect(service.getGoal(id)?.verify).toBe('pnpm typecheck')
    await service.submit(id, '/goal verify: off', 'queue')
    expect(service.getGoal(id)?.verify).toBeUndefined()
    expect(service.getGoal(id)?.objective).toBe('Login works')
  })

  it('pausing the goal ends a running verification without completing it', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Done', evidence)
    verifyResult = new Promise<VerifyResult>(() => {})
    done()
    await tick()
    expect(verifyCalls).toHaveLength(1)
    service.controlGoal(id, 'pause')
    expect(verifyCalls[0]!.signal.aborted).toBe(true)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused' })
    expect(service.getGoal(id)?.check).toBeUndefined()
  })

  it('completes on the evidence alone when the command was removed while the claim waited', async () => {
    service.setGoal(id, 'Login works', true, 'pnpm test')
    await service.updateGoal(id, 'completed', 'Done', evidence)
    expect(service.setVerify(id, null).claim).toBeUndefined()
    // Removing the command drops the claim, so the agent reports again and completes at once.
    expect(await service.updateGoal(id, 'completed', 'Done', evidence)).toMatchObject({ status: 'completed' })
  })
})

describe('goal stall detection', () => {
  beforeEach(() => {
    prefs.goals.maxTurns = null
  })

  it('blocks after two continuations that change nothing and repeat the same tool calls', async () => {
    service.setGoal(id, 'Login works')
    for (let n = 0; n < 3; n++) {
      emit({ kind: 'tool-use', toolUseId: `t${n}`, name: 'shell', summary: 'pnpm test' })
      emit({ kind: 'tool-result', toolUseId: `t${n}`, isError: false, summary: '3 failing' })
      done()
      await tick()
    }
    expect(prompts).toHaveLength(3)
    expect(service.getGoal(id)).toMatchObject({ status: 'blocked', turns: 2 })
    expect(service.getGoal(id)?.reason).toContain('No progress')
    expect(service.getGoal(id)?.stall?.unchanged).toBe(2)
    await tick(10_000)
    expect(prompts).toHaveLength(3)
  })

  it('tracks bounded result content and errors without volatile tool or terminal IDs', () => {
    const trail = (id: string, text: string, isError = false) =>
      turnActivity([
        { kind: 'tool-use', toolUseId: id, name: 'shell', summary: 'migration status' },
        {
          kind: 'tool-result',
          toolUseId: id,
          isError,
          summary: 'Result',
          content: [{ type: 'terminal', terminalId: id, output: text }],
        },
      ]).tools
    expect(trail('a', '1 done')).toBe(trail('b', '1 done'))
    expect(trail('a', '1 done')).not.toBe(trail('a', '2 done'))
    expect(trail('a', '1 done')).not.toBe(trail('a', '1 done', true))
    expect(trail('a', 'x'.repeat(100_000)).length).toBeLessThan(9000)
  })

  it('keeps remote work active while identical calls return changing results', async () => {
    service.setGoal(id, 'Finish remote migration')
    for (let n = 0; n < 5; n++) {
      emit({ kind: 'tool-use', toolUseId: `t${n}`, name: 'shell', summary: 'migration status' })
      emit({ kind: 'tool-result', toolUseId: `t${n}`, isError: false, summary: `${n} batches completed` })
      done()
      await tick()
      expect(service.getGoal(id)).toMatchObject({ status: 'active', stall: { unchanged: 0 } })
    }
  })

  it('ignores changing helper results and unassociated results when parent work repeats', async () => {
    service.setGoal(id, 'Finish migration')
    for (let n = 0; n < 3; n++) {
      emit({ kind: 'tool-use', toolUseId: `t${n}`, name: 'shell', summary: 'migration status' })
      emit({ kind: 'tool-result', toolUseId: `t${n}`, isError: false, summary: '0 completed' })
      emit({ kind: 'tool-use', agentId: 'helper', toolUseId: `h${n}`, name: 'shell', summary: `step ${n}` })
      emit({ kind: 'tool-result', agentId: 'helper', toolUseId: `h${n}`, isError: false, summary: `result ${n}` })
      emit({ kind: 'tool-result', toolUseId: `orphan${n}`, isError: false, summary: `result ${n}` })
      done()
      await tick()
    }
    expect(service.getGoal(id)).toMatchObject({ status: 'blocked', stall: { unchanged: 2 } })
  })

  it('does not stall while the tool trail or the files keep changing', async () => {
    service.setGoal(id, 'Login works')
    snapshot = { root: '/repo', files: {} }
    await tick(0)
    for (let n = 0; n < 4; n++) {
      // Identical tool calls, but each turn left different files behind.
      emit({ kind: 'tool-use', toolUseId: `t${n}`, name: 'shell', summary: 'pnpm test' })
      snapshot = { root: '/repo', files: { 'a.ts': `v${n}` } }
      done()
      await tick()
    }
    for (let n = 4; n < 8; n++) {
      work()
      done()
      await tick()
    }
    expect(service.getGoal(id)?.status).toBe('active')
    expect(prompts).toHaveLength(9)
  })

  it('counts changes made before the goal began as no progress', async () => {
    snapshot = { root: '/repo', files: { 'a.ts': 'old' } }
    service.setGoal(id, 'Login works')
    await tick(0)
    for (let n = 0; n < 3; n++) {
      done()
      await tick()
    }
    expect(service.getGoal(id)?.status).toBe('blocked')
  })

  it('does not count a retry after a usage limit, or a user message, towards a stall', async () => {
    service.setGoal(id, 'Login works')
    done()
    await tick()
    expect(service.getGoal(id)?.stall).toMatchObject({ unchanged: 0 })
    done()
    await tick()
    expect(service.getGoal(id)?.stall).toMatchObject({ unchanged: 1 })
    // Held at a usage limit and retried twice: the goal waits, and is never blocked as stalled.
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    expect(service.getGoal(id)).toMatchObject({ status: 'paused', pausedBy: 'provider-limit' })
    await tick(60_000)
    emit({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
    await tick(120_000)
    expect(service.getGoal(id)).toMatchObject({ status: 'active', stall: { unchanged: 1 } })
    // The user speaking resets the count.
    await service.submit(id, 'Also cover logout', 'queue')
    done()
    await tick()
    done()
    await tick()
    expect(service.getGoal(id)?.stall?.unchanged).toBeLessThan(2)
    expect(service.getGoal(id)?.status).toBe('active')
  })

  it('reaches the turn limit before it is called a stall', async () => {
    prefs.goals.maxTurns = 2
    service.setGoal(id, 'Login works')
    for (let n = 0; n < 4; n++) {
      done()
      await tick()
    }
    expect(service.getGoal(id)?.status).toBe('turn-limit')
  })

  it('starts counting again after the user resumes a blocked goal', async () => {
    service.setGoal(id, 'Login works')
    for (let n = 0; n < 3; n++) {
      done()
      await tick()
    }
    expect(service.getGoal(id)?.status).toBe('blocked')
    service.controlGoal(id, 'resume')
    expect(service.getGoal(id)?.stall).toBeUndefined()
    await tick()
    expect(service.getGoal(id)).toMatchObject({ status: 'active', stall: { unchanged: 0 } })
  })
})
