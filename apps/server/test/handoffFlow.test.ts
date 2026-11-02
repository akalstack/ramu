import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AgentProvider,
  type AgentSettings,
  type ProviderCatalog,
} from '@ramu/shared/types'
import { AgentService, type QueryFn } from '../src/agent'
import { ResumeUnavailable, type AgentRunnerFactory } from '../src/agent/agentRunner'
import { openDb, type Db } from '../src/db'
import type { SelectionTransition } from '../src/providers/selectionTransition'

/**
 * The handoff end to end: which provider session a thread resumes after a switch, what it is told, and what gets recorded.
 * The runner below is a scripted stand-in for a provider; it remembers every start so a test can read the prompt it got.
 */
interface Started {
  provider: AgentProvider
  model: string
  prompt: string
  resume: string | null
}
let db: Db
let tmp: string
let cwd: string
let starts: Started[]
let limited: Set<AgentProvider>
let unresumable: Set<string>
let nativeIds: boolean
let transition: SelectionTransition | undefined
let stopped: number
let nativeContext: { used: number; max: number } | null
let answer = ''

const catalog: ProviderCatalog[] = (['codex', 'cursor'] as const).map((provider) => ({
  provider,
  models: [
    { provider, id: `${provider}-m`, name: provider, efforts: ['low'], defaultEffort: 'low', isDefault: true },
    {
      provider,
      id: `${provider}-next`,
      name: `${provider} next`,
      efforts: ['low'],
      defaultEffort: 'low',
      isDefault: false,
    },
  ],
}))
const scopeOf = (dir: string) => ({ cwd: dir, additionalDirs: [], covers: [dir] })
const until = async (cond: () => boolean, ms = 6000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const codex: AgentSettings = {
  ...DEFAULT_AGENT_SETTINGS,
  provider: 'codex',
  model: 'codex-m',
  access: 'full',
  autoFallback: false,
}
const cursor: AgentSettings = { ...codex, provider: 'cursor', model: 'cursor-m' }

const factory: AgentRunnerFactory = (_scope, settings, emit) => {
  const run = async (prompt: string, resume: string | null) => {
    starts.push({ provider: settings.provider, model: settings.model, prompt, resume })
    if (resume && unresumable.has(resume)) throw new ResumeUnavailable('gone')
    if (nativeIds)
      emit({ kind: 'init', providerSessionId: `${settings.provider}-${starts.length}`, model: 'fake', cwd })
    emit({ kind: 'state', state: 'running' })
    if (nativeContext) emit({ kind: 'context', ...nativeContext })
    emit({ kind: 'thinking', text: 'PRIVATE-THOUGHT', messageId: `t${starts.length}` })
    if (limited.has(settings.provider)) {
      emit({ kind: 'result', text: "You've hit your usage limit.", isError: true, costUsd: null }, true)
      return
    }
    emit({
      kind: 'text',
      text: answer || `answer from ${settings.provider} #${starts.length}`,
      messageId: `m${starts.length}`,
    })
    emit({ kind: 'result', text: 'done', isError: false, costUsd: null })
  }
  return {
    planSettingsTransition: () => transition ?? { type: 'restart-and-resume' },
    start: (prompt, resume) => run(prompt, resume),
    // A live runner keeps its provider session, so a follow-up is a plain send.
    send: (prompt) => run(prompt, null),
    steer: async () => {},
    interrupt: async () => {},
    stop: async () => {
      stopped++
    },
    replyPermission: () => {},
    replyQuestion: () => {},
  }
}
const noClaude: QueryFn = () => {
  throw new Error('unused')
}
let services: AgentService[]
const make = (models = catalog) => {
  const svc = new AgentService(db, () => {}, noClaude, factory)
  vi.spyOn(svc, 'catalog').mockResolvedValue(models)
  services.push(svc)
  return svc
}
const idle = (svc: AgentService, id: string) => svc.get(id).state === 'idle'
/** Runs a message to completion and returns the start the provider received for it. */
const say = async (svc: AgentService, id: string, text: string) => {
  const before = starts.length
  await svc.send(id, text)
  await until(() => starts.length > before && idle(svc, id))
  return starts[starts.length - 1]!
}
const settingsEvents = (svc: AgentService, id: string) =>
  svc.events(id).filter((e): e is Extract<AgentEvent, { kind: 'settings' }> => e.kind === 'settings')

const smallCatalog = () =>
  catalog.map((entry) => ({
    ...entry,
    models: entry.models.map((model) => ({ ...model, contextWindow: 32_000 })),
  }))

beforeEach(() => {
  db = openDb(':memory:')
  starts = []
  limited = new Set()
  unresumable = new Set()
  nativeIds = true
  transition = undefined
  stopped = 0
  nativeContext = null
  answer = ''
  services = []
  tmp = mkdtempSync(join(tmpdir(), 'ramu-handoff-'))
  cwd = realpathSync(tmp)
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0);`)
})
afterEach(() => {
  for (const svc of services) svc.stopAll()
  rmSync(tmp, { recursive: true, force: true })
})

describe('what a switch carries', () => {
  it('compacts a large native session into a smaller model using the destination budget at preflight and launch', async () => {
    nativeContext = { used: 150_000, max: 200_000 }
    answer = 'old evidence '.repeat(6000)
    const svc = make(smallCatalog())
    const s = svc.start('t', scopeOf(cwd), 'remember plum and inspect the evidence', codex)
    await until(() => idle(svc, s.id))
    answer = ''
    await say(svc, s.id, 'now use those findings')
    await svc.configure(s.id, { ...codex, model: 'codex-next' })
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: true, handoffInfo: { contextWindow: 32_000 } })
    // A later catalog/telemetry change must not enlarge an already planned transfer.
    db.prepare("UPDATE model_context_windows SET context_max = 1000000 WHERE model = 'codex-next'").run()
    nativeContext = { used: 2000, max: 32_000 }
    const sent = await say(svc, s.id, 'continue on the smaller model')
    expect(sent.resume).toBeNull()
    expect(Buffer.byteLength(sent.prompt, 'utf8')).toBeLessThan(8500)
    expect(sent.prompt).toContain('remember plum and inspect the evidence')
    expect(sent.prompt).toContain('now use those findings')
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({
      handoffInfo: { mode: 'full', contextWindow: 32_000, shortened: expect.any(Number) },
    })
    expect(settingsEvents(svc, s.id).at(-1)!.handoffInfo!.shortened).toBeGreaterThan(0)
  })

  it('can resume natively on a smaller model when the current context leaves enough room', async () => {
    nativeContext = { used: 1000, max: 200_000 }
    const svc = make(smallCatalog())
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, { ...codex, model: 'codex-next' })
    // Outgoing usage is no longer attributed to the newly selected model.
    expect(svc.context(s.id)).toBeNull()
    const sent = await say(svc, s.id, 'continue')
    expect(sent.resume).toBe('codex-1')
    expect(sent.prompt).not.toContain('<ramu-handoff>')
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: false })
  })

  it('uses the smaller destination budget during automatic fallback too', async () => {
    nativeContext = { used: 150_000, max: 200_000 }
    answer = 'old evidence '.repeat(6000)
    const svc = make(smallCatalog())
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: {
        ...DEFAULT_APP_PREFERENCES.fallback,
        order: [
          { id: 'a', provider: 'codex', model: 'codex-m', effort: null },
          { id: 'b', provider: 'codex', model: 'codex-next', effort: null },
          { id: 'c', provider: 'cursor', model: 'cursor-m', effort: null },
        ],
      },
    })
    svc.usage = { list: () => [], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), 'remember plum', { ...codex, autoFallback: true })
    await until(() => idle(svc, s.id))
    nativeContext = null
    answer = ''
    limited.add('codex')
    await svc.send(s.id, 'continue')
    await until(() => svc.get(s.id).provider === 'cursor' && idle(svc, s.id))
    const smaller = starts.find((start) => start.model === 'codex-next')!
    expect(smaller.resume).toBeNull()
    expect(Buffer.byteLength(smaller.prompt, 'utf8')).toBeLessThan(8500)
    expect(smaller.prompt).toContain('remember plum')
    expect(settingsEvents(svc, s.id)).toContainEqual(
      expect.objectContaining({
        settings: expect.objectContaining({ model: 'codex-next' }),
        handoffInfo: expect.objectContaining({ cause: 'limit', contextWindow: 32_000 }),
      }),
    )
  })

  it("uses a fresh handoff instead of assuming an unknown model has the outgoing model's capacity", async () => {
    nativeContext = { used: 150_000, max: 1_000_000 }
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, { ...codex, model: 'codex-next' })
    nativeContext = null
    const sent = await say(svc, s.id, 'continue')
    expect(sent.resume).toBeNull()
    expect(sent.prompt).toContain('remember plum')
  })

  it('preserves the live session when a tiny destination cannot fit even the required handoff', async () => {
    nativeContext = { used: 150_000, max: 200_000 }
    const svc = make(
      catalog.map((entry) => ({ ...entry, models: entry.models.map((model) => ({ ...model, contextWindow: 2048 })) })),
    )
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    await expect(svc.configure(s.id, { ...codex, model: 'codex-next' })).rejects.toThrow('too large to carry')
    expect(stopped).toBe(0)
    expect(svc.get(s.id).settings.model).toBe(codex.model)
    expect(svc.context(s.id)).toMatchObject({ used: 150_000, max: 200_000 })
  })

  it('remembers observed model capacity across service restarts without sharing it with another account', async () => {
    nativeContext = { used: 1000, max: 32_000 }
    const svc = make()
    const first = svc.start('t', scopeOf(cwd), 'measure small model', cursor)
    await until(() => idle(svc, first.id))
    await svc.stopAndWait(first.id)
    const restored = make()
    nativeContext = { used: 150_000, max: 200_000 }
    const s = restored.start('t', scopeOf(cwd), 'continue work', codex)
    await until(() => idle(restored, s.id))
    await restored.configure(s.id, cursor)
    expect(settingsEvents(restored, s.id).at(-1)).toMatchObject({ handoffInfo: { contextWindow: 32_000 } })
    await restored.configure(s.id, { ...cursor, accountId: 'other' })
    expect(settingsEvents(restored, s.id).at(-1)!.handoffInfo?.contextWindow).toBeUndefined()
  })

  it('resumes the same native conversation when changing models is supported', async () => {
    nativeContext = { used: 1000, max: 200_000 }
    const svc = make(
      catalog.map((entry) => ({
        ...entry,
        models: entry.models.map((model) => ({ ...model, contextWindow: 200_000 })),
      })),
    )
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, { ...codex, model: 'codex-next' })
    const sent = await say(svc, s.id, 'continue')
    expect(sent.resume).toBe('codex-1')
    expect(sent.prompt).not.toContain('<ramu-handoff>')
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: false })
  })

  it('preflights a fresh-session model change and transfers history instead of resuming', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    transition = { type: 'handoff' }
    await svc.configure(s.id, { ...codex, model: 'codex-next' })
    expect(stopped).toBe(1)
    const sent = await say(svc, s.id, 'continue')
    expect(sent.resume).toBeNull()
    expect(sent.prompt).toContain('USER: remember plum')
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: true, handoffInfo: { mode: 'full' } })
  })

  it('leaves settings and the live conversation intact when the provider rejects a change', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'remember plum', codex)
    await until(() => idle(svc, s.id))
    transition = { type: 'reject', reason: 'Model switching is unavailable' }
    await expect(svc.configure(s.id, { ...codex, model: 'codex-next' })).rejects.toThrow(
      'Model switching is unavailable',
    )
    expect(stopped).toBe(0)
    expect(svc.get(s.id).settings.model).toBe(codex.model)
    expect(settingsEvents(svc, s.id)).toHaveLength(0)
    await say(svc, s.id, 'continue')
    expect(stopped).toBe(0)
  })

  it('refuses a same-provider fresh-session change before stopping when its history cannot fit', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'x'.repeat(150_000), codex)
    await until(() => idle(svc, s.id))
    transition = { type: 'handoff' }
    await expect(svc.configure(s.id, { ...codex, model: 'codex-next' })).rejects.toThrow('too large to carry')
    expect(stopped).toBe(0)
    expect(svc.get(s.id).settings.model).toBe(codex.model)
    expect(settingsEvents(svc, s.id)).toHaveLength(0)
  })

  it('skips a rejected same-provider fallback before stopping its runner', async () => {
    const svc = make()
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: {
        ...DEFAULT_APP_PREFERENCES.fallback,
        order: [
          { id: 'a', provider: 'codex', model: 'codex-m', effort: null },
          { id: 'b', provider: 'codex', model: 'codex-next', effort: null },
          { id: 'c', provider: 'cursor', model: 'cursor-m', effort: null },
        ],
      },
    })
    svc.usage = { list: () => [], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), 'seed', { ...codex, autoFallback: true })
    await until(() => idle(svc, s.id))
    transition = { type: 'reject', reason: 'Model switching is unavailable' }
    limited.add('codex')
    await svc.send(s.id, 'keep going')
    await until(() => svc.get(s.id).provider === 'cursor' && idle(svc, s.id))
    expect(starts.some((start) => start.model === 'codex-next')).toBe(false)
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: true, settings: { provider: 'cursor' } })
  })

  it('sends a cause-specific handoff in a <ramu-handoff> block, separate from the next request', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'plan the migration', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, cursor)
    const sent = await say(svc, s.id, 'now do step one')
    expect(sent.resume).toBeNull()
    expect(sent.prompt).toMatch(/^<ramu-handoff>/)
    expect(sent.prompt).toContain('</ramu-handoff>\n\nNext request: now do step one')
    expect(sent.prompt).toContain('USER: plan the migration')
    expect(sent.prompt).toContain('switched models')
    expect(sent.prompt).not.toContain('PRIVATE-THOUGHT')
  })

  it('records what was carried on the settings event that asked for it, in place', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'plan the migration', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, cursor)
    const marker = settingsEvents(svc, s.id).at(-1)!
    expect(marker.handoffInfo).toEqual({ cause: 'switch', mode: 'full', from: 'codex', fromSeq: 1 })
    await say(svc, s.id, 'continue')
    expect(settingsEvents(svc, s.id)).toHaveLength(1)
    const carried = settingsEvents(svc, s.id)[0]!.handoffInfo!
    expect(carried).toMatchObject({ cause: 'switch', mode: 'full', from: 'codex', fromSeq: 1, omitted: 0 })
    expect(carried.toSeq).toBeGreaterThan(2)
    expect(carried.chars).toBeGreaterThan(100)
  })

  it('names the limit as the cause when a provider hits one, and keeps the goal in the state block without guidance', async () => {
    const svc = make()
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: {
        ...DEFAULT_APP_PREFERENCES.fallback,
        order: [
          { id: 'a', provider: 'codex', model: 'codex-m', effort: null },
          { id: 'b', provider: 'cursor', model: 'cursor-m', effort: null },
        ],
      },
    })
    svc.usage = { list: () => [], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), 'seed', { ...codex, autoFallback: true })
    await until(() => idle(svc, s.id))
    svc.setGoal(s.id, 'Ship the release notes', true)
    limited.add('codex')
    await svc.send(s.id, 'keep going')
    await until(() => svc.get(s.id).provider === 'cursor' && starts.at(-1)?.provider === 'cursor')
    const sent = starts.at(-1)!
    expect(sent.prompt).toContain('hit a usage limit')
    // This thread has no guidance connection here, so the goal travels in the handoff itself.
    expect(sent.prompt).toContain('Ship the release notes')
    expect(settingsEvents(svc, s.id).at(-1)?.handoffInfo).toMatchObject({ cause: 'limit', from: 'codex' })
  })

  it('names the Shared MCP connections the fallback destination lacks on the settings event, and only then', async () => {
    const svc = make()
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: {
        ...DEFAULT_APP_PREFERENCES.fallback,
        order: [
          { id: 'a', provider: 'codex', model: 'codex-m', effort: null },
          { id: 'b', provider: 'cursor', model: 'cursor-m', effort: null },
        ],
      },
    })
    svc.usage = { list: () => [], update: () => {} }
    const checked: string[] = []
    svc.mcpDestination = async (_session, settings) => {
      checked.push(settings.provider)
      return [{ name: 'Tracker', status: 'approval-needed' }]
    }
    const s = svc.start('t', scopeOf(cwd), 'seed', { ...codex, autoFallback: true })
    await until(() => idle(svc, s.id))
    limited.add('codex')
    await svc.send(s.id, 'keep going')
    await until(() => svc.get(s.id).provider === 'cursor' && starts.at(-1)?.provider === 'cursor')
    expect(checked).toEqual(['cursor'])
    expect(settingsEvents(svc, s.id).at(-1)?.mcpAttention).toEqual([{ name: 'Tracker', status: 'approval-needed' }])
  })

  it('carries the goal through guidance, not twice, when the provider receives guidance', async () => {
    const svc = make()
    svc.toolConnection = () => ({ url: 'http://127.0.0.1:1', token: 't' })
    const s = svc.start('t', scopeOf(cwd), 'seed', codex)
    await until(() => idle(svc, s.id))
    svc.setGoal(s.id, 'Ship the release notes', true)
    await svc.configure(s.id, cursor)
    const sent = await say(svc, s.id, 'go on')
    const first = sent.prompt.indexOf('Ship the release notes')
    expect(first).toBeGreaterThan(-1)
    // The guidance block names the goal; the state block must not repeat it for a provider that already has it.
    expect(sent.prompt.slice(first + 1)).not.toContain('Ship the release notes\n')
  })
})

describe('a hardening: a launch without a native session always carries the conversation', () => {
  it('hands the earlier conversation to a provider that never reported a session id', async () => {
    nativeIds = false
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'remember the word plum', codex)
    await until(() => idle(svc, s.id))
    await svc.stopAndWait(s.id)
    const sent = await say(svc, s.id, 'what was the word?')
    expect(sent.resume).toBeNull()
    expect(sent.prompt).toContain('remember the word plum')
    expect(sent.prompt).toContain('</ramu-handoff>\n\nNext request: what was the word?')
    // Nothing had asked for it, so the launch says so on a settings row of its own.
    expect(settingsEvents(svc, s.id).at(-1)).toMatchObject({ handoff: true, handoffInfo: { mode: 'full' } })
  })

  it('a brand new thread gets no handoff', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), 'first message', codex)
    await until(() => idle(svc, s.id))
    expect(starts[0]!.prompt).toBe('first message')
    expect(settingsEvents(svc, s.id)).toHaveLength(0)
  })
})

describe('a returning provider', () => {
  const roundTrip = async (svc: AgentService) => {
    const s = svc.start('t', scopeOf(cwd), 'ALPHA plan the work', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, cursor)
    await say(svc, s.id, 'BRAVO do the cursor part')
    await svc.configure(s.id, codex)
    return s
  }

  it('resumes its own session and gets only what it missed', async () => {
    const svc = make()
    const s = await roundTrip(svc)
    const sent = await say(svc, s.id, 'CHARLIE and back')
    expect(sent.provider).toBe('codex')
    expect(sent.resume).toBe('codex-1')
    expect(sent.prompt).toContain('continuing your own earlier session')
    expect(sent.prompt).toContain('BRAVO do the cursor part')
    // Codex already saw the first request in its own session.
    expect(sent.prompt).not.toContain('ALPHA plan the work')
    const info = settingsEvents(svc, s.id).at(-1)!.handoffInfo!
    expect(info).toMatchObject({ mode: 'delta', cause: 'switch', from: 'cursor' })
    expect(info.fromSeq).toBeGreaterThan(2)
    expect(info.toSeq).toBeGreaterThanOrEqual(info.fromSeq!)
  })

  it('falls back to a full handoff when the provider cannot resume its session', async () => {
    const svc = make()
    const s = await roundTrip(svc)
    unresumable.add('codex-1')
    const before = starts.length
    await svc.send(s.id, 'CHARLIE and back')
    await until(() => starts.length === before + 2 && idle(svc, s.id))
    const [failedResume, full] = starts.slice(before)
    expect(failedResume).toMatchObject({ provider: 'codex', resume: 'codex-1' })
    expect(full!.resume).toBeNull()
    expect(full!.prompt).toContain('ALPHA plan the work')
    expect(full!.prompt).toContain('could not resume your saved session')
    // The session that cannot be resumed is forgotten, so the next switch back does not try it again.
    const row = db
      .prepare("SELECT 1 FROM session_provider_sessions WHERE session_id = ? AND provider = 'codex'")
      .get(s.id)
    expect(row).toBeUndefined()
  })

  it('never resumes a session that still remembers rewound turns', async () => {
    const svc = make()
    const s = await roundTrip(svc)
    await svc.stopAndWait(s.id)
    const user = svc
      .changes(s.id, 0, 0)
      .events.find((e) => e.event.kind === 'user' && e.event.text.startsWith('BRAVO'))!
    await svc.rewind(s.id, user.seq)
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_provider_sessions WHERE session_id = ?').get(s.id)).toEqual({
      n: 0,
    })
    const sent = await say(svc, s.id, 'DELTA after the rewind')
    expect(sent.resume).toBeNull()
    expect(sent.prompt).toContain('ALPHA plan the work')
    expect(sent.prompt).not.toContain('BRAVO do the cursor part')
    expect(sent.prompt).toContain('rewound')
  })
})

describe('the checkpoint is sent once', () => {
  it('goes out in the handoff and is left out of the session guidance for that launch only', async () => {
    const svc = make()
    const seen: (boolean | undefined)[] = []
    svc.toolConnection = () => ({ url: 'http://127.0.0.1:1', token: 't' })
    svc.sessionCheckpoint = () => ({ seq: 2, summary: 'CHECKPOINT-MARKER objective and progress' })
    svc.learningInstructions = (_session, options) => {
      seen.push(options?.checkpoint)
      return options?.checkpoint === false ? '' : 'GUIDANCE-WITH CHECKPOINT-MARKER'
    }
    const s = svc.start('t', scopeOf(cwd), 'plan it', codex)
    await until(() => idle(svc, s.id))
    await svc.configure(s.id, cursor)
    const sent = await say(svc, s.id, 'go on')
    expect(sent.prompt.split('CHECKPOINT-MARKER')).toHaveLength(2)
    expect(seen.at(-1)).toBe(false)
    // An ordinary launch still gets the checkpoint through guidance.
    expect(seen[0]).toBe(true)
  })
})

describe('a conversation that does not fit', () => {
  const huge = 'x'.repeat(130_000)

  it('refuses a model switch before changing anything', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), huge, codex)
    await until(() => idle(svc, s.id))
    await expect(svc.configure(s.id, cursor)).rejects.toThrow(/too large to carry to Cursor/)
    expect(svc.get(s.id).provider).toBe('codex')
    expect(settingsEvents(svc, s.id)).toHaveLength(0)
    expect(starts).toHaveLength(1)
  })

  it('still switches when an old message carries a large attachment, since only the attachment is collapsed', async () => {
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), `review this\n\n<ramu-context>\n${huge}\n</ramu-context>`, codex)
    await until(() => idle(svc, s.id))
    await say(svc, s.id, 'and then?')
    await svc.configure(s.id, cursor)
    const sent = await say(svc, s.id, 'continue')
    expect(sent.provider).toBe('cursor')
    expect(sent.prompt).toContain('USER: review this')
    expect(sent.prompt).toContain('[attached context omitted:')
    expect(sent.prompt).not.toContain('xxxxxxxxxx')
    expect(sent.prompt.length).toBeLessThan(120_000)
  })

  it('holds a thread at its limit with the reason instead of sending a truncated handoff', async () => {
    const svc = make()
    svc.preferences = () => ({
      ...DEFAULT_APP_PREFERENCES,
      fallback: {
        ...DEFAULT_APP_PREFERENCES.fallback,
        order: [
          { id: 'a', provider: 'codex', model: 'codex-m', effort: null },
          { id: 'b', provider: 'cursor', model: 'cursor-m', effort: null },
        ],
      },
    })
    svc.usage = { list: () => [], update: () => {} }
    const s = svc.start('t', scopeOf(cwd), huge, { ...codex, autoFallback: true })
    await until(() => idle(svc, s.id))
    limited.add('codex')
    await svc.send(s.id, 'next')
    await until(() => !!svc.providerWait(s.id))
    expect(starts.every((entry) => entry.provider === 'codex')).toBe(true)
    expect(svc.providerWait(s.id)?.reason).toMatch(/too large to carry to Cursor/)
    expect(svc.get(s.id).state).toBe('idle')
    expect(svc.get(s.id).provider).toBe('codex')
  })

  it('refuses a rewound or lost-session launch rather than sending a truncated prompt', async () => {
    nativeIds = false
    const svc = make()
    const s = svc.start('t', scopeOf(cwd), huge, codex)
    await until(() => idle(svc, s.id))
    await svc.stopAndWait(s.id)
    await svc.send(s.id, 'again')
    await until(() => svc.get(s.id).state === 'failed')
    expect(svc.events(s.id).some((e) => e.kind === 'error' && /too large to carry/.test(e.message))).toBe(true)
    // The message the user typed is still in the thread.
    expect(svc.events(s.id).some((e) => e.kind === 'user' && e.text === 'again')).toBe(true)
    expect(starts).toHaveLength(1)
  })
})
