import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AgentProvider,
  type AgentSettings,
  type AppPreferences,
  type ProviderCatalog,
  type UsageReading,
} from '@ramu/shared/types'
import { AgentService, type QueryFn } from '../src/agent'
import type { AgentRunnerFactory } from '../src/agent/agentRunner'
import { LIMIT_CONTINUATION, earlyTryBackoff } from '../src/agent/providerWait'
import { ProviderLimitError } from '../src/agent/usageLimit'
import { openDb, type Db } from '../src/db'
import { MobilePush } from '../src/remote/mobilePush'

/** Runs the real service against a scripted runner, so limit handling is exercised end to end without a provider. */
interface Script {
  /** Every start emits a confident limit while this is true. */
  limit: boolean
  /** A low-confidence limit signal for this many starts, then success. */
  low: number
  /** A runtime error thrown by `start` (as a rejected promise) while set. */
  throws: string | null
}
interface Started {
  provider: AgentProvider
  prompt: string
  resume: string | null
  at: number
}

let db: Db
let tmp: string
let cwd: string
let starts: Started[]
let script: Script
let services: AgentService[]

const catalog: ProviderCatalog[] = [
  {
    provider: 'claude-code',
    models: [
      {
        provider: 'claude-code',
        id: 'sonnet',
        name: 'Sonnet',
        efforts: ['low'],
        defaultEffort: 'low',
        isDefault: true,
      },
    ],
  },
  {
    provider: 'codex',
    models: [
      { provider: 'codex', id: 'codex-test', name: 'Codex', efforts: ['low'], defaultEffort: 'low', isDefault: true },
    ],
  },
]
const scopeOf = (dir: string) => ({ cwd: dir, additionalDirs: [], covers: [dir] })
const until = async (cond: () => boolean, ms = 6000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const factory: AgentRunnerFactory = (_scope, settings, emit) => {
  let n = 0
  const run = async (prompt: string, resume: string | null) => {
    starts.push({ provider: settings.provider, prompt, resume, at: Date.now() })
    if (script.throws) throw new Error(script.throws)
    emit({ kind: 'init', providerSessionId: `native-${starts.length}`, model: 'fake', cwd })
    emit({ kind: 'state', state: 'running' })
    if (script.limit) {
      emit({ kind: 'result', text: "You've hit your usage limit.", isError: true, costUsd: null }, true)
      return
    }
    if (script.low > 0) {
      script.low--
      emit({ kind: 'result', text: 'Rate limit exceeded?', isError: true, costUsd: null }, 'low')
      return
    }
    emit({ kind: 'text', text: `answer ${++n}`, messageId: `m${starts.length}` })
    emit({ kind: 'result', text: 'done', isError: false, costUsd: null })
  }
  return {
    start: (prompt, resume) => run(prompt, resume),
    send: (prompt) => run(prompt, null),
    steer: async () => {},
    interrupt: async () => {},
    stop: async () => {},
    replyPermission: () => {},
    replyQuestion: () => {},
  }
}

const noClaude: QueryFn = () => {
  throw new Error('Claude SDK is not used in these tests')
}
const make = (prefs: Partial<AppPreferences['fallback']> = {}) => {
  const svc = new AgentService(db, () => {}, noClaude, factory)
  vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
  svc.preferences = () => ({
    ...DEFAULT_APP_PREFERENCES,
    fallback: { ...DEFAULT_APP_PREFERENCES.fallback, ...prefs },
  })
  services.push(svc)
  return svc
}
// Claude Code keeps the SDK loop, so the scripted runner stands in for Codex.
const stay: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full', autoFallback: false }

const waitOf = (svc: AgentService, id: string) => svc.providerWait(id)
const record = (svc: AgentService, id: string, event: AgentEvent) =>
  (svc as unknown as { record: (id: string, event: AgentEvent) => void }).record(id, event)
/** Moves the recorded reset into the past, as if the limit had lifted. */
const expire = (svc: AgentService, id: string) => {
  const wait = waitOf(svc, id)!
  record(svc, id, { ...wait, retryAt: Date.now() - 1, updatedAt: Date.now(), at: undefined } as AgentEvent)
}
const groups = (svc: AgentService) =>
  (svc as unknown as { parts: { providerWaits: { groups: Map<string, unknown> } } }).parts.providerWaits.groups
const timers = (svc: AgentService) =>
  (svc as unknown as { parts: { providerWaits: { noticeTimers: Map<string, unknown> } } }).parts.providerWaits
    .noticeTimers
const failed = (svc: AgentService, id: string) =>
  svc.get(id).state === 'failed' || svc.events(id).some((e) => e.kind === 'state' && e.state === 'failed')

beforeEach(() => {
  db = openDb(':memory:')
  starts = []
  script = { limit: false, low: 0, throws: null }
  services = []
  tmp = mkdtempSync(join(tmpdir(), 'ramu-wait-'))
  cwd = realpathSync(tmp)
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0),
           ('t2', 'p', 'T2', 'current', 'idle', 0);`)
})
afterEach(() => {
  for (const svc of services) svc.stopAll()
  rmSync(tmp, { recursive: true, force: true })
})

describe('boot path', () => {
  it('index.ts re-arms waits through the single recoverOnBoot call', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    // Removing the call, or going back to loose calls that can be dropped one by one, must fail this.
    expect(source).toMatch(/await agents\.recoverOnBoot\(\)/)
    expect(source).not.toMatch(/agents\.goalsSettingsChanged\(\)/)
  })

  it('recoverOnBoot restores helpers, resumes interrupted chats, then re-arms goal and limit timers, in that order', async () => {
    const svc = make()
    const order: string[] = []
    vi.spyOn(svc, 'restoreHelperTranscripts').mockImplementation(async () => void order.push('helpers'))
    vi.spyOn(svc, 'resumeInterruptedChats').mockImplementation(async () => void order.push('resume'))
    vi.spyOn(svc, 'goalsSettingsChanged').mockImplementation(() => void order.push('rearm'))
    await svc.recoverOnBoot()
    expect(order).toEqual(['helpers', 'resume', 'rearm'])
  })

  it('a wait saved before a restart is resumed only after recoverOnBoot', async () => {
    script.limit = true
    const first = make()
    const s = first.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(first, s.id))
    first.stopAll(true)
    script.limit = false
    const restarted = make()
    expire(restarted, s.id)
    // A restart that never re-arms leaves the wait unattended: nothing continues the thread.
    await sleep(1500)
    expect(starts).toHaveLength(1)
    await restarted.recoverOnBoot()
    await until(() => !waitOf(restarted, s.id) && starts.length === 2)
    expect(starts[1]!.prompt).toContain(LIMIT_CONTINUATION)
    expect(restarted.get(s.id).state).toBe('idle')
  })
})

describe('a thread held at a usage limit', () => {
  it('waits and resumes with switching enabled when only one provider and model are available', async () => {
    script.limit = true
    const svc = make()
    vi.mocked(svc.catalog).mockResolvedValue(catalog.filter((entry) => entry.provider === 'codex'))
    const s = svc.start('t', scopeOf(cwd), 'task', { ...stay, model: 'codex-test', autoFallback: true })
    await until(() => !!waitOf(svc, s.id) && svc.get(s.id).state === 'idle')
    expect(starts.map((start) => start.provider)).toEqual(['codex'])
    expect(waitOf(svc, s.id)).toMatchObject({ provider: 'codex', accountId: 'default' })
    expect(failed(svc, s.id)).toBe(false)

    script.limit = false
    expire(svc, s.id)
    await until(() => !waitOf(svc, s.id) && svc.get(s.id).state === 'idle' && starts.length === 2)
    expect(starts[1]).toMatchObject({ provider: 'codex', prompt: LIMIT_CONTINUATION })
    expect(failed(svc, s.id)).toBe(false)
  })

  it('records the wait with its login, never fails, and shows an unknown reset as guessed', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(waitOf(svc, s.id)).toMatchObject({ guessed: true, provider: 'codex', accountId: 'default' })
    expect(svc.get(s.id).state).toBe('idle')
    expect(failed(svc, s.id)).toBe(false)
    expect(svc.events(s.id).filter((e) => e.kind === 'user')).toHaveLength(1)
  })

  it('uses the reset the provider reported, and marks it as known', async () => {
    script.limit = true
    const svc = make()
    const resetsAt = Date.now() + 90 * 60_000
    const reading: UsageReading = {
      provider: 'codex',
      window: 'five_hour',
      usedPercent: 100,
      status: 'limited',
      resetsAt,
      updatedAt: Date.now(),
    }
    svc.usage = { list: () => [reading], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(waitOf(svc, s.id)).toMatchObject({ retryAt: resetsAt + 1000 })
    expect(waitOf(svc, s.id)?.guessed).toBe(false)
  })

  it('continues once the reset passes and records that the wait ended', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    script.limit = false
    expire(svc, s.id)
    await until(() => !waitOf(svc, s.id) && svc.get(s.id).state === 'idle' && starts.length === 2)
    expect(starts[1]!.prompt).toBe(LIMIT_CONTINUATION)
    expect(svc.events(s.id).findLast((e) => e.kind === 'provider-wait')).toMatchObject({ retryAt: null })
  })

  it('keeps waiting, with a longer backoff, when the provider is still limited after the timer', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    const first = waitOf(svc, s.id)!
    expire(svc, s.id)
    await until(() => starts.length === 2 && !!waitOf(svc, s.id) && waitOf(svc, s.id)!.retryAt! > Date.now())
    expect(waitOf(svc, s.id)!.updatedAt).toBeGreaterThan(first.updatedAt)
    expect(failed(svc, s.id)).toBe(false)
  })

  it('is cancelled by Stop, and nothing runs afterwards', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    svc.stop(s.id)
    expect(waitOf(svc, s.id)).toBeNull()
    expect(groups(svc).size).toBe(0)
    script.limit = false
    await sleep(1300)
    expect(starts).toHaveLength(1)
  })

  it('is cleared when the thread is marked done, so it never resumes a done thread', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    svc.holdThread('t')
    expect(waitOf(svc, s.id)).toBeNull()
    expect(groups(svc).size).toBe(0)
    script.limit = false
    await sleep(1300)
    expect(starts).toHaveLength(1)
  })

  it('treats a 429 whose retries ran out as a limit wait, not a failure', async () => {
    script.throws = '429 Too Many Requests: retries exhausted after 3 attempts'
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(failed(svc, s.id)).toBe(false)
    expect(svc.get(s.id).state).toBe('idle')
  })

  it('keeps a prompt-too-long error as an ordinary failure', async () => {
    script.throws = 'prompt is too long: 250000 tokens > 200000 maximum'
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'failed')
    expect(waitOf(svc, s.id)).toBeNull()
  })

  it('retries a low-confidence match once before holding the thread, and never holds a misread error', async () => {
    script.low = 1
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'idle' && starts.length === 2)
    // The quiet retry worked, so the thread never entered the limit wait.
    expect(svc.events(s.id).some((e) => e.kind === 'provider-wait')).toBe(false)
    expect(svc.events(s.id).some((e) => e.kind === 'text' && e.text === 'answer 1')).toBe(true)
  })

  it('holds the thread when the low-confidence match repeats after the quiet retry', async () => {
    script.low = 5
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(starts).toHaveLength(2)
    expect(failed(svc, s.id)).toBe(false)
  })
})

describe('waits shared by one provider login', () => {
  it('threads on the same login share one timer; another login has its own', async () => {
    script.limit = true
    const svc = make()
    const a = svc.start('t', scopeOf(cwd), 'one', stay)
    await until(() => !!waitOf(svc, a.id))
    const b = svc.start('t2', scopeOf(cwd), 'two', stay)
    await until(() => !!waitOf(svc, b.id))
    expect(groups(svc).size).toBe(1)
    const other = svc.start('t2', scopeOf(cwd), 'three', { ...stay, provider: 'cursor' })
    await until(() => !!waitOf(svc, other.id))
    expect([...groups(svc).keys()].sort()).toEqual(['codex:default', 'cursor:default'])
    svc.stop(a.id)
    expect(groups(svc).size).toBe(2)
    svc.stop(b.id)
    expect([...groups(svc).keys()]).toEqual(['cursor:default'])
  })

  it('resumes the first thread at once and spreads the rest at random', async () => {
    script.limit = true
    const svc = make()
    svc.waitSpread.perThreadMs = 400
    svc.waitSpread.maxMs = 400
    svc.waitSpread.random = () => 0.99
    const a = svc.start('t', scopeOf(cwd), 'one', stay)
    await until(() => !!waitOf(svc, a.id))
    const b = svc.start('t2', scopeOf(cwd), 'two', stay)
    await until(() => !!waitOf(svc, b.id))
    script.limit = false
    const before = starts.length
    expire(svc, a.id)
    expire(svc, b.id)
    await until(() => starts.length === before + 2)
    const [first, second] = starts.slice(before)
    // A lone waiter is never delayed; the second one is held back inside the spread window.
    expect(second!.at - first!.at).toBeGreaterThanOrEqual(300)
    expect(second!.at - first!.at).toBeLessThan(1500)
    await until(() => svc.get(a.id).state === 'idle' && svc.get(b.id).state === 'idle')
  })
})

describe('auto-resume policy', () => {
  it('follows the global setting when the thread has no choice, and the thread choice when it has one', async () => {
    const svc = make({ autoResume: false })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'idle')
    expect(svc.autoResumeOf(s.id)).toBe(false)
    svc.setAutoResume(s.id, true)
    expect(svc.autoResumeOf(s.id)).toBe(true)
    expect(svc.get(s.id).settings.autoResume).toBe(true)
    svc.setAutoResume(s.id, null)
    expect(svc.get(s.id).settings).not.toHaveProperty('autoResume')
    expect(svc.autoResumeOf(s.id)).toBe(false)
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: { ...DEFAULT_APP_PREFERENCES.fallback, autoResume: true },
    })
    expect(svc.autoResumeOf(s.id)).toBe(true)
  })

  it('does not drop or set the thread choice when other settings are saved', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'idle')
    svc.setAutoResume(s.id, false)
    await svc.configure(s.id, { ...stay, access: 'edits' })
    expect(svc.get(s.id).settings).toMatchObject({ access: 'edits', autoResume: false })
    await svc.configure(s.id, { ...stay, access: 'full', autoResume: true })
    expect(svc.get(s.id).settings.autoResume).toBe(false)
  })

  it('with auto-resume off records the wait, schedules no retry and never fails the thread', async () => {
    script.limit = true
    const svc = make({ autoResume: false })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(groups(svc).size).toBe(0)
    expect(svc.get(s.id).state).toBe('idle')
    script.limit = false
    expire(svc, s.id)
    await sleep(1500)
    expect(starts).toHaveLength(1)
    expect(waitOf(svc, s.id)).not.toBeNull()
    expect(failed(svc, s.id)).toBe(false)
  })

  it('keeps messages typed during the wait queued until the user resumes', async () => {
    script.limit = true
    const svc = make({ autoResume: false })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    await svc.send(s.id, 'typed during the limit')
    expect(svc.queued(s.id).map((m) => m.text)).toEqual(['typed during the limit'])
    script.limit = false
    const result = await svc.retryLimitNow(s.id)
    expect(result.resumed).toBe(true)
    await until(() => svc.queued(s.id).length === 0 && svc.get(s.id).state === 'idle')
    expect(
      svc
        .events(s.id)
        .filter((e) => e.kind === 'user')
        .at(-1),
    ).toMatchObject({ text: 'typed during the limit' })
  })

  it('announces a known reset once when nothing will continue the thread, and not again after a restart', async () => {
    script.limit = true
    const svc = make({ autoResume: false })
    const resetsAt = Date.now() + 300
    const reading: UsageReading = {
      provider: 'codex',
      window: 'five_hour',
      usedPercent: 100,
      status: 'limited',
      resetsAt,
      updatedAt: Date.now(),
    }
    svc.usage = { list: () => [reading], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    await until(() => waitOf(svc, s.id)?.resetNotifiedAt !== undefined, 4000)
    expect(svc.events(s.id).filter((e) => e.kind === 'provider-wait' && e.resetNotifiedAt !== undefined)).toHaveLength(
      1,
    )
    expect(starts).toHaveLength(1)
    svc.stopAll(true)
    const restarted = make({ autoResume: false })
    await restarted.recoverOnBoot()
    await sleep(300)
    expect(timers(restarted).size).toBe(0)
    expect(
      restarted.events(s.id).filter((e) => e.kind === 'provider-wait' && e.resetNotifiedAt !== undefined),
    ).toHaveLength(1)
  })

  it('turning auto-resume on re-arms an existing wait, and off drops its timer, at once', async () => {
    script.limit = true
    let autoResume = false
    const svc = make()
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: { ...DEFAULT_APP_PREFERENCES.fallback, autoResume },
    })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(groups(svc).size).toBe(0)
    autoResume = true
    svc.goalsSettingsChanged()
    expect(groups(svc).size).toBe(1)
    script.limit = false
    expire(svc, s.id)
    await until(() => !waitOf(svc, s.id) && starts.length === 2)
    // Off again for a fresh wait: the timer that was armed is dropped.
    script.limit = true
    await svc.send(s.id, 'again')
    await until(() => !!waitOf(svc, s.id))
    expect(groups(svc).size).toBe(1)
    autoResume = false
    svc.goalsSettingsChanged()
    expect(groups(svc).size).toBe(0)
  })

  it('a thread override re-arms or clears only that thread, with the global value left alone', async () => {
    script.limit = true
    const svc = make({ autoResume: false })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect(groups(svc).size).toBe(0)
    svc.setAutoResume(s.id, true)
    expect(groups(svc).size).toBe(1)
    svc.setAutoResume(s.id, false)
    expect(groups(svc).size).toBe(0)
    svc.setAutoResume(s.id, null)
    expect(groups(svc).size).toBe(0)
  })

  it('sub-agents follow their parent: its own choice, else the live global value', async () => {
    const svc = make({ autoResume: true })
    const parent = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(parent.id).state === 'idle')
    const create = (svc as unknown as { createSession: (...a: unknown[]) => { id: string } }).createSession
    const child = create.call(svc, 't', scopeOf(cwd), stay, 'idle', parent.id)
    expect(svc.autoResumeOf(child.id)).toBe(true)
    svc.setAutoResume(parent.id, false)
    expect(svc.autoResumeOf(child.id)).toBe(false)
    svc.setAutoResume(parent.id, null)
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: { ...DEFAULT_APP_PREFERENCES.fallback, autoResume: false },
    })
    expect(svc.autoResumeOf(child.id)).toBe(false)
    // The child's own choice wins.
    svc.setAutoResume(child.id, true)
    expect(svc.autoResumeOf(child.id)).toBe(true)
  })

  it('sessions and preferences saved before the setting existed behave as auto-resume on', async () => {
    const legacy = { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: false }
    db.prepare(
      "INSERT INTO agent_sessions (id, task_id, repo_id, provider, cwd, covers, state, created_at, settings) VALUES ('old', 't', 'r', 'claude-code', ?, ?, 'idle', 0, ?)",
    ).run(cwd, JSON.stringify([cwd]), JSON.stringify(legacy))
    const svc = make()
    svc.preferences = () => ({ ...DEFAULT_APP_PREFERENCES, fallback: { switchAt: null } as AppPreferences['fallback'] })
    expect(svc.autoResumeOf('old')).toBe(true)
  })
})

describe('agent.retryLimitNow', () => {
  const reading = (patch: Partial<UsageReading>): UsageReading => ({
    provider: 'codex',
    window: 'five_hour',
    usedPercent: 100,
    status: 'limited',
    updatedAt: Date.now(),
    ...patch,
  })
  const withUsage = (svc: AgentService, readings: () => UsageReading[]) => {
    svc.usage = { list: () => readings(), update: () => {} }
  }

  it('does nothing for a thread that is not at a limit', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'idle')
    expect(await svc.retryLimitNow(s.id)).toEqual({ resumed: false, retryAt: null, guessed: false })
  })

  it('resumes when fresh usage shows room', async () => {
    script.limit = true
    const svc = make()
    let readings = [reading({})]
    withUsage(svc, () => readings)
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    script.limit = false
    readings = [reading({ status: 'ok', usedPercent: 10, updatedAt: Date.now() + 1 })]
    expect((await svc.retryLimitNow(s.id)).resumed).toBe(true)
    await until(() => !waitOf(svc, s.id) && svc.get(s.id).state === 'idle' && starts.length === 2)
  })

  it('stays in the wait with the updated reset and no failed turn when the provider is still limited', async () => {
    script.limit = true
    const svc = make()
    const resetsAt = Date.now() + 2 * 3_600_000
    withUsage(svc, () => [reading({ resetsAt })])
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    const result = await svc.retryLimitNow(s.id)
    expect(result).toEqual({ resumed: false, retryAt: resetsAt + 1000, guessed: false })
    expect(waitOf(svc, s.id)).toMatchObject({ retryAt: resetsAt + 1000, guessed: false })
    expect(starts).toHaveLength(1)
    expect(failed(svc, s.id)).toBe(false)
    expect(svc.events(s.id).filter((e) => e.kind === 'error' && !/usage limit/i.test(e.message))).toHaveLength(0)
    expect(svc.get(s.id).state).toBe('idle')
  })

  it('tries for real when the only limit reading is one Ramu inferred from a notice', async () => {
    script.limit = true
    const svc = make()
    withUsage(svc, () => [reading({ source: 'notice', resetsAt: Date.now() + 3_600_000 })])
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    script.limit = false
    expect((await svc.retryLimitNow(s.id)).resumed).toBe(true)
    await until(() => !waitOf(svc, s.id) && svc.get(s.id).state === 'idle')
  })

  it('goes back into the wait, not to failed, when the retried provider is still limited', async () => {
    script.limit = true
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    expect((await svc.retryLimitNow(s.id)).resumed).toBe(true)
    await until(() => starts.length === 2 && !!waitOf(svc, s.id))
    expect(failed(svc, s.id)).toBe(false)
  })

  it('continues on another provider: choosing it, then trying again, hands the conversation over and runs there', async () => {
    script.limit = true
    const svc = make()
    vi.spyOn(svc, 'catalog').mockResolvedValue([
      ...catalog,
      {
        provider: 'opencode',
        models: [
          { provider: 'opencode', id: 'oc', name: 'OC', efforts: ['low'], defaultEffort: 'low', isDefault: true },
        ],
      },
    ])
    // Codex is limited; nothing is known about the other provider.
    withUsage(svc, () => [reading({ resetsAt: Date.now() + 3_600_000 })])
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    script.limit = false
    await svc.configure(s.id, { ...stay, provider: 'opencode', model: 'oc', effort: 'low' })
    expect(svc.get(s.id).provider).toBe('opencode')
    expect((await svc.retryLimitNow(s.id)).resumed).toBe(true)
    await until(() => starts.length === 2 && !waitOf(svc, s.id) && svc.get(s.id).state === 'idle')
    expect(starts[1]).toMatchObject({ provider: 'opencode', resume: null })
    expect(starts[1]!.prompt).toContain('<ramu-handoff')
    expect(failed(svc, s.id)).toBe(false)
  })

  it('works with auto-resume off, and resuming a waiting goal clears the wait', async () => {
    script.limit = true
    const svc = make({ autoResume: false })
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => !!waitOf(svc, s.id))
    svc.setGoal(s.id, 'Ship it', true)
    script.limit = false
    svc.controlGoal(s.id, 'resume')
    expect(waitOf(svc, s.id)).toBeNull()
  })
})

describe('sub-agents at a usage limit', () => {
  const parentOf = async (svc: AgentService) => {
    const s = svc.start('t', scopeOf(cwd), 'task', stay)
    await until(() => svc.get(s.id).state === 'idle')
    return s
  }

  it('wait with their login instead of failing, keep their card running, then finish', async () => {
    const svc = make()
    const parent = await parentOf(svc)
    script.limit = true
    const started = await svc.spawnSubagent(parent.id, { description: 'Survey', prompt: 'List', background: true })
    await until(() => !!waitOf(svc, started.agentId))
    expect(svc.get(started.agentId).state).toBe('idle')
    expect(failed(svc, started.agentId)).toBe(false)
    expect(svc.task(parent.id, started.agentId)).toMatchObject({ status: 'running' })
    expect(groups(svc).size).toBe(1)
    script.limit = false
    expire(svc, started.agentId)
    await until(() => svc.task(parent.id, started.agentId)?.status === 'completed')
    expect(waitOf(svc, started.agentId)).toBeNull()
  })

  it('keep their card running when their parent enters the same limit wait, and both continue after the reset', async () => {
    const svc = make()
    const parent = await parentOf(svc)
    script.limit = true
    const started = await svc.spawnSubagent(parent.id, { description: 'Survey', prompt: 'List', background: true })
    await until(() => !!waitOf(svc, started.agentId))
    // The parent now hits the same limit. Its helper must not be settled as stopped with it.
    await svc.send(parent.id, 'more work')
    await until(() => !!waitOf(svc, parent.id))
    expect(svc.task(parent.id, started.agentId)).toMatchObject({ status: 'running' })
    expect(groups(svc).size).toBe(1)
    script.limit = false
    expire(svc, started.agentId)
    expire(svc, parent.id)
    await until(() => svc.task(parent.id, started.agentId)?.status === 'completed')
    await until(() => !waitOf(svc, parent.id) && svc.get(parent.id).state === 'idle')
    expect(failed(svc, parent.id)).toBe(false)
    expect(failed(svc, started.agentId)).toBe(false)
  })

  it('with auto-resume off stop at the limit with the reason, never as failed', async () => {
    const svc = make({ autoResume: false })
    const parent = await parentOf(svc)
    script.limit = true
    const started = await svc.spawnSubagent(parent.id, { description: 'Survey', prompt: 'List', background: true })
    await until(() => svc.task(parent.id, started.agentId)?.status === 'stopped')
    expect(svc.task(parent.id, started.agentId)?.status).not.toBe('failed')
    expect(groups(svc).size).toBe(0)
  })

  it('a helper wait saved before a restart is re-armed, though helpers are not top-level threads', async () => {
    const svc = make()
    const parent = await parentOf(svc)
    const create = (svc as unknown as { createSession: (...a: unknown[]) => { id: string } }).createSession
    const child = create.call(svc, 't', scopeOf(cwd), stay, 'idle', parent.id)
    record(svc, child.id, { kind: 'provider-wait', retryAt: Date.now() - 1, updatedAt: Date.now(), guessed: true })
    svc.goalsSettingsChanged()
    await until(() => starts.some((s) => s.prompt === LIMIT_CONTINUATION))
    await until(() => !waitOf(svc, child.id))
  })
})

describe('background analysis at a usage limit', () => {
  const limitedFactory =
    (until: { ok: boolean }): AgentRunnerFactory =>
    (_scope, _settings, emit) => ({
      start: async () => {
        if (until.ok) {
          emit({ kind: 'text', text: 'the answer' })
          emit({ kind: 'result', text: 'done', isError: false, costUsd: null })
        } else emit({ kind: 'result', text: 'usage limit', isError: true, costUsd: null }, true)
      },
      send: async () => {},
      steer: async () => {},
      interrupt: async () => {},
      stop: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    })
  const codex: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', autoFallback: false, access: 'full' }
  const analysis = (state: { ok: boolean }, resetsInMs?: number) => {
    const svc = new AgentService(db, () => {}, noClaude, limitedFactory(state))
    vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
    svc.preferences = () => DEFAULT_APP_PREFERENCES
    svc.usage = {
      list: () =>
        resetsInMs === undefined
          ? []
          : [
              {
                provider: 'codex',
                window: 'five_hour',
                usedPercent: 100,
                status: 'limited',
                resetsAt: Date.now() + resetsInMs,
                updatedAt: Date.now(),
              },
            ],
      update: () => {},
    }
    services.push(svc)
    return svc
  }

  it('reports a limit as a pause with its reset, not as an error string', async () => {
    const svc = analysis({ ok: false }, 3_600_000)
    const error = await svc.analyze('prompt', codex).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderLimitError)
    expect((error as ProviderLimitError).resetsAt).toBeGreaterThan(Date.now())
    expect((error as Error).message).toMatch(/usage limit/i)
  })

  it('waits out the limit and retries when the work can be deferred', async () => {
    const state = { ok: false }
    const svc = analysis(state, 50)
    const waits: (number | null)[] = []
    const result = svc.analyze('prompt', codex, undefined, { defer: { onWait: (at) => waits.push(at) } })
    setTimeout(() => (state.ok = true), 200)
    expect((await result).message).toBe('the answer')
    expect(waits[0]).toEqual(expect.any(Number))
    expect(waits.at(-1)).toBeNull()
  })

  it('does not wait when auto-resume is off, or past the longest wait', async () => {
    const svc = analysis({ ok: false }, 50)
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: { ...DEFAULT_APP_PREFERENCES.fallback, autoResume: false },
    })
    await expect(svc.analyze('prompt', codex, undefined, { defer: true })).rejects.toBeInstanceOf(ProviderLimitError)
    svc.preferences = () => DEFAULT_APP_PREFERENCES
    await expect(svc.analyze('prompt', codex, undefined, { defer: { maxWaitMs: 100 } })).rejects.toBeInstanceOf(
      ProviderLimitError,
    )
  })

  it('stops waiting when the caller aborts', async () => {
    const svc = analysis({ ok: false }, 60_000)
    const abort = new AbortController()
    const result = svc.analyze('prompt', codex, undefined, { defer: true, signal: abort.signal })
    setTimeout(() => abort.abort(), 100)
    await expect(result).rejects.toThrow(/stopped/)
  })

  it('treats a low-confidence match as an ordinary error and never waits on it', async () => {
    const factory: AgentRunnerFactory = (_scope, _settings, emit) => ({
      start: async () => emit({ kind: 'result', text: 'rate limit?', isError: true, costUsd: null }, 'low'),
      send: async () => {},
      steer: async () => {},
      interrupt: async () => {},
      stop: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    })
    const svc = new AgentService(db, () => {}, noClaude, factory)
    vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
    services.push(svc)
    const error = await svc.analyze('prompt', codex, undefined, { defer: true }).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(ProviderLimitError)
  })
})

describe('notifying that a limit reset', () => {
  it('sends one push when the reset passed and auto-resume is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-push-'))
    try {
      const fetched: unknown[] = []
      const push = new MobilePush(join(dir, 'push.json'), () => [{ id: 'phone' }], (async (
        _url: unknown,
        init: { body: string },
      ) => {
        fetched.push(JSON.parse(init.body))
        return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
      }) as unknown as typeof fetch)
      push.register('phone', 'ExponentPushToken[abcdefghijklmnop]', 'computer')
      const session = { id: 's', taskId: 't', parentId: null } as never
      push.observe(session, { kind: 'provider-wait', retryAt: 10, updatedAt: 1 })
      expect(fetched).toHaveLength(0)
      push.observe(session, { kind: 'provider-wait', retryAt: 10, updatedAt: 1, resetNotifiedAt: 20 })
      await until(() => fetched.length === 1)
      expect(fetched[0]).toMatchObject({ data: { kind: 'input', sessionId: 's' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('early tries at a limit', () => {
  it('back off from five minutes to an hour, so a reading that shows room the provider denies cannot loop', () => {
    expect([1, 2, 3, 4, 5, 9].map((count) => earlyTryBackoff(count) / 60_000)).toEqual([5, 10, 20, 40, 60, 60])
  })
})
