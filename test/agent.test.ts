import { configureProviderBinaries } from '../src/main/providerBinaries'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService, claudeDefaultEffort, cleanTitle, conversationHandoff, serverToolResult, serverToolUse, isUsageLimit, type QueryFn } from '../src/main/agent'
import { openDb, type Db } from '../src/main/db'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type ProviderCatalog } from '../src/shared/types'
import { fakeCodex } from '../src/main/fakeAgent'

/** Minimal stand-in for the SDK: echoes each user message, asks permission once for the first one. */
function fakeQuery(calls: Options[]): QueryFn {
  return ({ prompt, options }) => {
    calls.push(options)
    async function* run(): AsyncGenerator<SDKMessage, void> {
      yield { type: 'system', subtype: 'init', session_id: 'provider-1', model: 'fake', cwd: options.cwd! } as SDKMessage
      let first = true
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
        const text = m.message.content as string
        if (text.includes('[limit claude]')) {
          yield { type: 'result', subtype: 'success', is_error: true, result: 'usage_limit_reached', total_cost_usd: 0 } as unknown as SDKMessage
          return
        }
        if (first) {
          first = false
          const res = await options.canUseTool!('Bash', { command: 'touch x' }, { signal: options.abortController!.signal, toolUseID: 't1' } as never)
          yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `perm:${res?.behavior}` }] } } as unknown as SDKMessage
        }
        if (text === 'compact' || text === 'compact failed') {
          yield { type: 'system', subtype: 'status', status: 'compacting', uuid: '00000000-0000-0000-0000-000000000001', session_id: 'provider-1' } as SDKMessage
          if (text === 'compact') yield { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 212000, post_tokens: 33700 }, uuid: '00000000-0000-0000-0000-000000000002', session_id: 'provider-1' } as SDKMessage
          else yield { type: 'system', subtype: 'status', status: null, compact_result: 'failed', uuid: '00000000-0000-0000-0000-000000000003', session_id: 'provider-1' } as SDKMessage
        }
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `echo:${text}` }] } } as unknown as SDKMessage
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 } as unknown as SDKMessage
      }
    }
    return Object.assign(run(), { interrupt: async () => undefined }) as unknown as Query
  }
}

const scopeOf = (dir: string, extra: string[] = []) => ({ cwd: dir, additionalDirs: extra, covers: [dir, ...extra] })

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let db: Db
let events: { id: string; event: AgentEvent }[]
let tmp: string
let cwd: string

beforeEach(() => {
  db = openDb(':memory:')
  events = []
  tmp = mkdtempSync(join(tmpdir(), 'ramu-agent-'))
  cwd = realpathSync(tmp)
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0),
           ('t2', 'p', 'T2', 'current', 'idle', 0);`)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('AgentService', () => {
  it('passes the configured user Claude CLI to the SDK', async () => {
    const calls: Options[] = []
    configureProviderBinaries({ 'claude-code': { binary: '/custom user bin/claude' } })
    const svc = new AgentService(db, () => {}, fakeQuery(calls))
    try {
      const session = svc.start('t', scopeOf(cwd), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
      await until(() => svc.get(session.id).state === 'idle')
      expect(calls[0]?.pathToClaudeCodeExecutable).toBe('/custom user bin/claude')
      svc.stop(session.id)
    } finally { configureProviderBinaries({}) }
  })

  it('emits durable event positions so snapshots and live delivery can merge without duplicates', async () => {
    const delivered: { event: AgentEvent; seq?: number }[] = []
    const svc = new AgentService(db, (_id, event, seq) => delivered.push({ event, seq }), fakeQuery([]))
    const session = svc.start('t', scopeOf(cwd), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(session.id).state === 'idle')
    const recorded = delivered.filter((i) => i.event.kind !== 'state')
    expect(recorded.map((i) => i.seq)).toEqual(svc.events(session.id).map((_e, index) => index + 1))
    expect(delivered.filter((i) => i.event.kind === 'state').every((i) => i.seq === undefined)).toBe(true)
    svc.stop(session.id)
  })

  it.each(['compact', 'compact failed'])('records Claude compaction status and completion durably: %s', async (prompt) => {
    const svc = new AgentService(db, () => {}, fakeQuery([]))
    const session = svc.start('t', scopeOf(cwd), prompt, { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(session.id).state === 'idle')
    expect(svc.events(session.id).filter((e) => e.kind === 'compaction').map(({ at, ...e }) => e)).toEqual([
      { kind: 'compaction', state: 'started' },
      prompt === 'compact' ? { kind: 'compaction', state: 'completed', beforeTokens: 212000, afterTokens: 33700 } : { kind: 'compaction', state: 'failed' },
    ])
    svc.stop(session.id)
  })

  it('launches in the binding cwd, routes permission requests and records the transcript', async () => {
    const calls: Options[] = []
    const svc = new AgentService(db, (id, event) => events.push({ id, event }), fakeQuery(calls))
    const s = svc.start('t', scopeOf(cwd), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'ask' })
    expect(calls[0]!.cwd).toBe(cwd)

    await until(() => events.some((e) => e.event.kind === 'permission-request'))
    expect(svc.get(s.id).state).toBe('needs-input')
    const req = events.find((e) => e.event.kind === 'permission-request')!.event as Extract<AgentEvent, { kind: 'permission-request' }>
    svc.replyPermission(s.id, req.requestId, true)

    await until(() => svc.get(s.id).state === 'idle')
    const kinds = svc.events(s.id).map((e) => (e.kind === 'text' ? e.text : e.kind))
    expect(kinds).toEqual(['user', 'init', 'permission-request', 'request-resolved', 'perm:allow', 'echo:hello', 'result'])
    expect(svc.get(s.id).providerSessionId).toBe('provider-1')
    expect(svc.list('t')[0]!.title).toBe('hello')

    await svc.send(s.id, 'again')
    await until(() => svc.events(s.id).some((e) => e.kind === 'text' && e.text === 'echo:again'))
    svc.stop(s.id)
    expect(svc.get(s.id).state).toBe('stopped')
  })

  it('allows one active writer per canonical checkout, across tasks', async () => {
    const svc = new AgentService(db, () => {}, fakeQuery([]))
    const s = svc.start('t', scopeOf(cwd), 'one')
    expect(() => svc.start('t2', scopeOf(cwd), 'two')).toThrow(/already writing/)
    await svc.stopAndWait(s.id)
    expect(() => svc.start('t2', scopeOf(cwd), 'two')).not.toThrow()
  })

  it('treats a workspace-scoped agent as a writer in every repository it covers', () => {
    const svc = new AgentService(db, () => {}, fakeQuery([]))
    const ws = svc.start('t', { cwd: '/ws', additionalDirs: [], covers: ['/ws/web', '/ws/api'] }, 'all repos')
    expect(() => svc.start('t2', scopeOf('/ws/api'), 'just api')).toThrow(/already writing in \/ws\/api/)
    expect(() => svc.start('t2', scopeOf('/elsewhere'), 'other')).not.toThrow()
    svc.stop(ws.id)
  })

  it('passes directories outside the working directory to the SDK', () => {
    const calls: Options[] = []
    const svc = new AgentService(db, () => {}, fakeQuery(calls))
    const s = svc.start('t', scopeOf(cwd, ['/other/repo']), 'hello')
    expect(calls[0]!.additionalDirectories).toEqual(['/other/repo'])
    svc.stop(s.id)
  })

  it('reports sessions as restored (not running) after a restart, and resumes natively on send', async () => {
    const calls: Options[] = []
    const first = new AgentService(db, () => {}, fakeQuery(calls))
    const s = first.start('t', scopeOf(cwd), 'hello')
    await until(() => first.get(s.id).providerSessionId !== null)

    // Simulate an app restart: a new service over the same database, the old process gone.
    const second = new AgentService(db, () => {}, fakeQuery(calls))
    second.markRestoredOnBoot()
    expect(second.get(s.id).state).toBe('restored')
    expect(second.events(s.id).length).toBeGreaterThan(0)

    await second.send(s.id, 'continue')
    expect(calls.at(-1)!.resume).toBe('provider-1')
    expect(calls.at(-1)!.cwd).toBe(cwd)
    second.stop(s.id)
  })
})

// Real provider run. Costs a small amount of usage on the configured Claude account; opt in explicitly.
describe.runIf(process.env.RAMU_REAL_AGENT === '1')('Claude Code via Agent SDK (real)', () => {
  it('runs in the binding cwd and edits files there only after approval', { timeout: 180_000 }, async () => {
    execFileSync('git', ['init', '-q'], { cwd })
    const svc = new AgentService(db, (id, event) => events.push({ id, event }), query as unknown as QueryFn)
    const s = svc.start('t', scopeOf(cwd), 'Create a file named hello.txt in the current directory containing exactly the text: hi from ramu. Do nothing else.', { ...DEFAULT_AGENT_SETTINGS, access: 'ask' })

    // Approve whatever the agent asks for, recording what was asked.
    const asked: string[] = []
    await until(() => {
      for (const e of svc.events(s.id)) {
        if (e.kind === 'permission-request' && !asked.includes(e.requestId)) {
          asked.push(e.requestId)
          svc.replyPermission(s.id, e.requestId, true)
        }
      }
      const st = svc.get(s.id).state
      return st === 'idle' || st === 'failed'
    }, 170_000)

    const evs = svc.events(s.id)
    const init = evs.find((e) => e.kind === 'init') as Extract<AgentEvent, { kind: 'init' }>
    console.log('agent transcript:', JSON.stringify(evs, null, 1))
    expect(svc.get(s.id).state).toBe('idle')
    expect(realpathSync(init.cwd)).toBe(cwd)
    expect(asked.length).toBeGreaterThan(0)
    expect(readFileSync(join(cwd, 'hello.txt'), 'utf8').trim()).toMatch(/^hi from ramu\.?$/)
    svc.stop(s.id)
  })
})

const catalog: ProviderCatalog[] = [
  { provider: 'claude-code', models: [{ provider: 'claude-code', id: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }] },
  { provider: 'codex', models: [{ provider: 'codex', id: 'codex-test', name: 'Codex test', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }] },
]
function service(calls: Options[] = []) {
  const svc = new AgentService(db, (id, event) => events.push({ id, event }), fakeQuery(calls), fakeCodex)
  vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
  return svc
}
const full = { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const }

describe('Conversation provider settings and handoffs', () => {
  it('passes model, effort and full access to Claude and persists them', async () => {
    const calls: Options[] = []
    const svc = service(calls)
    const settings = { ...full, model: 'sonnet', effort: 'high' as const }
    const s = svc.start('t', scopeOf(cwd), 'hello', settings)
    await until(() => svc.get(s.id).state === 'idle')
    expect(calls[0]).toMatchObject({ model: 'sonnet', effort: 'high', permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true })
    expect(svc.get(s.id).settings).toEqual(settings)
    expect(svc.events(s.id).some((e) => e.kind === 'permission-request')).toBe(false)
    svc.stopAll()
  })

  it('switches providers in the same chat with visible context, scope and access preserved', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd, ['/other/repo']), 'Remember the password reset task', full)
    await until(() => svc.get(s.id).state === 'idle')
    await svc.configure(s.id, { ...full, provider: 'codex', model: 'codex-test', effort: 'high' })
    await svc.send(s.id, 'Now implement it')
    await until(() => svc.get(s.id).state === 'idle')
    expect(svc.list('t')).toHaveLength(1)
    expect(svc.get(s.id)).toMatchObject({ id: s.id, provider: 'codex', cwd, additionalDirs: ['/other/repo'], covers: [cwd, '/other/repo'] })
    expect(svc.events(s.id)).toContainEqual(expect.objectContaining({ kind: 'settings', handoff: true }))
    expect(svc.events(s.id).some((e) => e.kind === 'text' && e.text.includes('USER: Remember the password reset task') && e.text.includes('Now implement it'))).toBe(true)
    expect(svc.events(s.id).filter((e) => e.kind === 'user')).toHaveLength(2)
    svc.stopAll()
  })

  it('changes effort and permissions while a turn is waiting for approval, cancels the old request and resumes natively', async () => {
    const calls: Options[] = []
    const svc = service(calls)
    const s = svc.start('t', scopeOf(cwd), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'ask' })
    await until(() => svc.get(s.id).state === 'needs-input')
    await svc.configure(s.id, { ...full, model: 'sonnet', effort: 'high' })
    expect(svc.events(s.id)).toContainEqual(expect.objectContaining({ kind: 'request-resolved', outcome: 'cancelled' }))
    await until(() => svc.get(s.id).state === 'idle')
    await svc.send(s.id, 'continue')
    await until(() => svc.get(s.id).state === 'idle')
    expect(calls.at(-1)).toMatchObject({ resume: 'provider-1', effort: 'high', permissionMode: 'bypassPermissions' })
    expect(svc.events(s.id)).toContainEqual(expect.objectContaining({ kind: 'settings', handoff: false }))
    svc.stopAll()
  })

  it('falls back automatically on a Claude usage limit without recording an extra user message', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), 'Finish the change [limit claude]', full)
    await until(() => svc.get(s.id).provider === 'codex' && svc.get(s.id).state === 'idle')
    expect(svc.get(s.id).settings.access).toBe('full')
    expect(svc.events(s.id).filter((e) => e.kind === 'user')).toHaveLength(1)
    expect(svc.events(s.id)).toContainEqual(expect.objectContaining({ kind: 'settings', reason: expect.stringContaining('usage limit reached'), handoff: true }))
    svc.stopAll()
  })

  it('falls back from Codex to Claude too', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), 'Finish the change [limit codex]', { ...full, provider: 'codex' })
    await until(() => svc.get(s.id).provider === 'claude-code' && svc.get(s.id).state === 'idle')
    expect(svc.events(s.id).filter((e) => e.kind === 'settings')).toHaveLength(1)
    svc.stopAll()
  })

  it('stops instead of bouncing between two limited providers', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), '[limit claude] [limit codex]', full)
    await until(() => svc.get(s.id).state === 'failed')
    expect(svc.events(s.id).filter((e) => e.kind === 'settings')).toHaveLength(1)
    expect(svc.events(s.id)).toContainEqual(expect.objectContaining({ kind: 'error', message: expect.stringContaining('Both providers') }))
    await svc.stopAndWait(s.id)
    expect(svc.activeWriter([cwd])).toBeNull()
    svc.stopAll()
  })

  it('pauses on limits when fallback is off', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), '[limit claude]', { ...full, autoFallback: false })
    await until(() => svc.get(s.id).state === 'failed')
    expect(svc.get(s.id).provider).toBe('claude-code')
    expect(svc.events(s.id).some((e) => e.kind === 'settings')).toBe(false)
    svc.stopAll()
  })

  it('rejects unsupported model/effort pairs without stopping the existing provider', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), 'hello', full)
    await until(() => svc.get(s.id).state === 'idle')
    await expect(svc.configure(s.id, { ...full, provider: 'codex', model: 'codex-test', effort: 'ultra' })).rejects.toThrow(/does not support/)
    expect(svc.get(s.id).provider).toBe('claude-code')
    expect(svc.get(s.id).state).toBe('idle')
    svc.stopAll()
  })

  it('does not switch after the user stops during catalog loading', async () => {
    const svc = service()
    const s = svc.start('t', scopeOf(cwd), 'hello', full)
    await until(() => svc.get(s.id).state === 'idle')
    let resolve!: (c: ProviderCatalog[]) => void
    vi.mocked(svc.catalog).mockReturnValue(new Promise((r) => { resolve = r }))
    const changing = svc.configure(s.id, { ...full, provider: 'codex', model: 'codex-test' })
    svc.stop(s.id)
    resolve(catalog)
    await expect(changing).rejects.toThrow(/cancelled/)
    expect(svc.get(s.id).provider).toBe('claude-code')
    expect(svc.get(s.id).state).toBe('stopped')
    svc.stopAll()
  })

  it('classifies usage failures without treating authentication or tool errors as limits', () => {
    expect(isUsageLimit({ api_error: 'usage_limit_reached' })).toBe(true)
    expect(isUsageLimit({ codexErrorInfo: 'usageLimitExceeded' })).toBe(true)
    expect(isUsageLimit(new Error('Unauthorized'))).toBe(false)
    expect(isUsageLimit('file does not exist')).toBe(false)
    expect(conversationHandoff([{ kind: 'user', text: 'fix login' }, { kind: 'tool-result', toolUseId: 'x', isError: false, summary: 'already edited login.ts' }])).toContain('already edited login.ts')
  })
})

describe('AI commit message drafts', () => {
  it('uses no Claude tools, denies any attempted tool, and never creates an agent chat', async () => {
    const calls: Options[] = []
    const svc = service(calls)
    const result = await svc.draftCommit('diff --git a/login.ts b/login.ts\n+fixLogin()', { ...full, model: 'sonnet', effort: 'low' })
    expect(result.message).toContain('fixLogin')
    expect(calls[0]).toMatchObject({ tools: [], maxTurns: 1, permissionMode: 'default', effort: 'low' })
    expect(calls[0]!.cwd).not.toBe(cwd)
    expect(result.message).toContain('perm:deny')
    expect(svc.list('t')).toHaveLength(0)
    svc.stopAll()
  })
  it('refuses empty and oversized diffs before launching a provider', async () => {
    const calls: Options[] = []
    const svc = service(calls)
    await expect(svc.draftCommit('', full)).rejects.toThrow(/Stage changes/)
    await expect(svc.draftCommit('x'.repeat(120_001), full)).rejects.toThrow(/too large/)
    expect(calls).toHaveLength(0)
    svc.stopAll()
  })
})

it('AI drafts fall back on a structured Codex usage error while remaining read-only', async () => {
  const calls: Options[] = []
  let readOnly: boolean | undefined
  const limitCodex: import('../src/main/codex').CodexFactory = (_scope, _settings, emit, readonly) => {
    readOnly = readonly
    return { start: async () => { emit({ kind: 'error', message: 'Limit reached' }, true) }, send: async () => {}, steer: async () => {}, stop: async () => {}, interrupt: async () => {}, replyPermission: () => {}, replyQuestion: () => {} }
  }
  const svc = new AgentService(db, () => {}, fakeQuery(calls), limitCodex)
  vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
  const result = await svc.draftCommit('diff --git a/login.ts b/login.ts\n+fixLogin()', { ...full, provider: 'codex', model: 'codex-test' })
  expect(readOnly).toBe(true)
  expect(result.provider).toBe('claude-code')
  expect(calls[0]!.tools).toEqual([])
  expect(svc.list('t')).toHaveLength(0)
  svc.stopAll()
})


describe('busy agent messages', () => {
  function setup() {
    let emit!: (event: AgentEvent) => void
    const send = vi.fn(async (_text: string) => {})
    const steer = vi.fn(async (_text: string) => {})
    const factory: import('../src/main/codex').CodexFactory = (_scope, _settings, output) => {
      emit = output
      return { start: async () => { emit({ kind: 'state', state: 'running' }) }, send, steer,
        interrupt: async () => {}, stop: async () => {}, replyPermission: () => {}, replyQuestion: () => {} }
    }
    const service = new AgentService(db, () => {}, fakeQuery([]), factory)
    const session = service.start('t', scopeOf(cwd), 'initial', { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' })
    return { service, session, send, steer, complete: () => emit({ kind: 'result', text: 'done', isError: false, costUsd: null }) }
  }

  it('queues another chat until the previous run snapshot is complete', async () => {
    const { service, session, complete } = setup()
    let release!: () => void
    const capture = new Promise<void>((resolve) => { release = resolve })
    const begin = vi.fn(async () => 'review'), followup = vi.fn(async () => {})
    service.reviewHooks = { begin, bind: () => {}, abandon: () => {}, followup, complete: async (id) => { if (id === session.id) await capture } }
    const second = await service.startReviewed('t2', scopeOf(cwd), 'second chat', { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' })
    expect(second.state).toBe('idle'); expect(service.queued(second.id)[0]?.text).toBe('second chat')
    expect(begin).not.toHaveBeenCalled(); expect(followup).not.toHaveBeenCalled()
    complete()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(service.activeWriter([cwd])?.id).toBe(session.id)
    expect(followup).not.toHaveBeenCalled()
    release()
    await until(() => service.get(second.id).state === 'running')
    expect(followup).toHaveBeenCalledWith(second.id)
    expect(service.queued(second.id)).toEqual([])
    service.stopAll(); await service.stopAndWait(session.id); await service.stopAndWait(second.id)
  })

  it('pauses queued review feedback if its checkout changed before execution', async () => {
    const { service, session, send, complete } = setup()
    const validateFeedback = vi.fn(async (): Promise<void> => { throw new Error('Return to branch main') })
    service.reviewHooks = { begin: async () => 'r', bind: () => {}, abandon: () => {}, followup: async () => {}, validateFeedback }
    await service.submit(session.id, 'review feedback', 'queue', [], 'r')
    complete()
    await until(() => validateFeedback.mock.calls.length === 1)
    await until(() => service.queued(session.id).length === 1)
    expect(send).not.toHaveBeenCalled()
    expect(service.events(session.id).findLast((e) => e.kind === 'queue')).toMatchObject({ paused: true, messages: [{ text: 'review feedback', reviewId: 'r' }] })
    validateFeedback.mockResolvedValue(undefined)
    service.resumeQueue(session.id)
    await until(() => send.mock.calls.length === 1)
    service.stopAll()
  })

  it('waits for completion and sends queued messages in order, one per turn', async () => {
    const { service, session, send, complete } = setup()
    await service.submit(session.id, 'first', 'queue')
    await service.submit(session.id, 'second', 'queue')
    expect(send).not.toHaveBeenCalled()
    complete()
    await until(() => send.mock.calls.length === 1)
    expect(send).toHaveBeenNthCalledWith(1, 'first', [])
    expect(service.queued(session.id).map((m) => m.text)).toEqual(['second'])
    complete()
    await until(() => send.mock.calls.length === 2)
    expect(send).toHaveBeenNthCalledWith(2, 'second', [])
    service.stopAll()
  })

  it('recalls a queued message and refuses stale recalls', async () => {
    const { service, session, complete, send } = setup()
    await service.submit(session.id, 'recall me', 'queue')
    const message = service.queued(session.id)[0]!
    service.removeQueued(session.id, message.id)
    expect(() => service.removeQueued(session.id, message.id)).toThrow(/already/)
    complete()
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    service.stopAll()
  })

  it('steers the current Codex turn without draining queued follow-ups', async () => {
    const { service, session, steer, send } = setup()
    await service.submit(session.id, 'later', 'queue')
    await service.submit(session.id, 'redirect now', 'steer')
    expect(steer).toHaveBeenCalledWith('redirect now', undefined)
    expect(send).not.toHaveBeenCalled()
    expect(service.queued(session.id).map((m) => m.text)).toEqual(['later'])
    service.stopAll()
  })

  it('preserves queued input after stopping and across service restoration', async () => {
    const { service, session } = setup()
    await service.submit(session.id, 'keep me', 'queue')
    service.stop(session.id)
    const restored = new AgentService(db, () => {}, fakeQuery([]))
    restored.markRestoredOnBoot()
    expect(restored.queued(session.id).map((m) => m.text)).toEqual(['keep me'])
  })

  it('does not record rejected steering as a user message', async () => {
    const { service, session, steer } = setup()
    steer.mockRejectedValueOnce(new Error('turn mismatch'))
    await service.submit(session.id, 'rejected', 'steer')
    expect(service.queued(session.id).map((message) => message.text)).toEqual(['rejected'])
    expect(service.events(session.id).some((e) => e.kind === 'user' && e.text === 'rejected')).toBe(false)
    service.stopAll()
  })
})

it('Claude steering buffers without interrupting response text or tools', async () => {
  let release!: () => void
  const interrupt = vi.fn(async () => { release() })
  const query: QueryFn = ({ prompt }) => {
    async function* run(): AsyncGenerator<SDKMessage, void> {
      yield { type: 'system', subtype: 'init', session_id: 'steering-test', model: 'fake', cwd } as SDKMessage
      let first = true
      for await (const message of prompt) {
        if (first) { first = false; await new Promise<void>((resolve) => { release = resolve }) }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: String(message.message.content) }] } } as unknown as SDKMessage
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 } as unknown as SDKMessage
      }
    }
    return Object.assign(run(), { interrupt }) as unknown as Query
  }
  const service = new AgentService(db, () => {}, query)
  const session = service.start('t', scopeOf(cwd), 'initial')
  await until(() => !!release)
  await service.submit(session.id, 'later', 'queue')
  await service.submit(session.id, 'steer first', 'steer')
  expect(interrupt).not.toHaveBeenCalled()
  expect(service.events(session.id).some((event) => event.kind === 'text')).toBe(false)
  // Finish the simulated in-flight response/tool call; native input becomes available next.
  release()
  await until(() => service.events(session.id).some((event) => event.kind === 'text' && event.text === 'later'))
  expect(interrupt).not.toHaveBeenCalled()
  expect(service.events(session.id).filter((event) => event.kind === 'user').map((event) => event.text)).toEqual(['initial', 'steer first', 'later'])
  service.stopAll()
})

it('keeps queued text when dispatch fails and does not retry in a loop', async () => {
  const service = new AgentService(db, () => {}, fakeQuery([]), fakeCodex)
  const session = service.start('t', scopeOf(cwd), 'initial', { ...DEFAULT_AGENT_SETTINGS, access: 'ask' })
  await until(() => service.get(session.id).state === 'needs-input')
  await service.submit(session.id, 'keep after failure', 'queue')
  const send = vi.spyOn(service, 'send').mockRejectedValueOnce(new Error('checkout unavailable'))
  const request = service.events(session.id).find((event) => event.kind === 'permission-request')!
  if (request.kind !== 'permission-request') throw new Error('missing permission')
  service.replyPermission(session.id, request.requestId, true)
  await until(() => service.events(session.id).some((event) => event.kind === 'error'))
  expect(service.queued(session.id).map((message) => message.text)).toEqual(['keep after failure'])
  expect(send).toHaveBeenCalledOnce()
  service.stopAll()
})

it('pause retains the queue until explicitly resumed', async () => {
  const svc = new AgentService(db, () => {}, fakeQuery([]), fakeCodex)
  const session = svc.start('t', scopeOf(cwd), 'initial', { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'ask' })
  await until(() => svc.get(session.id).state === 'needs-input')
  await svc.submit(session.id, 'later', 'queue')
  const send = vi.spyOn(svc, 'send')
  await svc.interrupt(session.id)
  await Promise.resolve()
  expect(send).not.toHaveBeenCalled()
  expect(svc.queued(session.id).map((message) => message.text)).toEqual(['later'])
  svc.resumeQueue(session.id)
  await until(() => send.mock.calls.length === 1)
  svc.stopAll()
})

it('Claude receives images as native content blocks and text files as context', async () => {
  const { AttachmentStore } = await import('../src/main/attachments')
  const store = new AttachmentStore(join(tmp, 'attachments'))
  const image = store.add('screen.png', Buffer.from('image bytes'))
  const text = store.add('notes.txt', Buffer.from('Expected behavior'))
  let content: SDKUserMessage['message']['content'] | undefined
  const query: QueryFn = ({ prompt }) => {
    async function* run(): AsyncGenerator<SDKMessage, void> {
      for await (const message of prompt) {
        content = message.message.content
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 } as unknown as SDKMessage
      }
    }
    return Object.assign(run(), { interrupt: async () => undefined }) as unknown as Query
  }
  const svc = new AgentService(db, () => {}, query)
  const session = svc.start('t', scopeOf(cwd), '', DEFAULT_AGENT_SETTINGS, [image, text])
  await until(() => content !== undefined)
  expect(content).toEqual([
    expect.objectContaining({ type: 'text', text: expect.stringContaining('Expected behavior') }),
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('image bytes').toString('base64') } },
  ])
  expect(svc.events(session.id)[0]).toMatchObject({ kind: 'user', attachments: [image, text] })
  svc.stopAll()
})

describe('cleanTitle', () => {
  it('keeps one plain line', () => {
    expect(cleanTitle('"Fix the login redirect."\nBecause…')).toBe('Fix the login redirect')
    expect(cleanTitle('Title: **Add dark mode**')).toBe('Add dark mode')
    expect(cleanTitle('  \n')).toBeNull()
    expect(cleanTitle('x'.repeat(80))!.length).toBeLessThanOrEqual(60)
  })
})

describe('server-side tools (web search and fetch)', () => {
  it('turns server_tool_use and its result into tool events', () => {
    expect(serverToolUse({ id: 'srv1', name: 'web_search', input: { query: 'jadwal imunisasi IDAI 2024' } })).toEqual({ toolUseId: 'srv1', name: 'WebSearch', summary: 'jadwal imunisasi IDAI 2024' })
    expect(serverToolUse({ id: 'srv2', name: 'web_fetch', input: { url: 'https://idai.or.id' } })).toMatchObject({ name: 'WebFetch', summary: 'https://idai.or.id' })
    expect(serverToolResult({ tool_use_id: 'srv1', content: [{ type: 'web_search_result', title: 'Jadwal', url: 'https://idai.or.id/x' }] })).toMatchObject({ isError: false, summary: 'Jadwal — https://idai.or.id/x' })
    expect(serverToolResult({ tool_use_id: 'srv1', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } })).toMatchObject({ isError: true, summary: 'unavailable' })
  })
})

describe('claudeDefaultEffort', () => {
  it('defaults to medium, else the middle level, else none', () => {
    expect(claudeDefaultEffort(['low', 'medium', 'high'])).toBe('medium')
    expect(claudeDefaultEffort(['low', 'high'])).toBe('low')
    expect(claudeDefaultEffort([])).toBeNull()
  })
})

it.each(['cursor', 'antigravity', 'opencode'] as const)('routes %s through its native runner and persists the provider session', async (provider) => {
  const native = vi.fn(fakeCodex)
  const unused = vi.fn(() => { throw new Error('Wrong provider adapter') })
  const svc = new AgentService(db, (id, event) => events.push({ id, event }), fakeQuery([]), unused, native, native)
  const session = svc.start('t', scopeOf(cwd), 'hello', { ...DEFAULT_AGENT_SETTINGS, provider, model: 'native-model' })
  await until(() => svc.get(session.id).state === 'idle')
  expect(native).toHaveBeenCalledOnce()
  expect(unused).not.toHaveBeenCalled()
  expect(svc.get(session.id).provider).toBe(provider)
  expect(svc.get(session.id).providerSessionId).toBeTruthy()
  await svc.send(session.id, 'follow-up')
  await until(() => svc.get(session.id).state === 'idle')
  expect(native).toHaveBeenCalledOnce()
  await svc.stopAndWait(session.id)
  expect(svc.activeWriter([cwd])).toBeNull()
})

it('keeps steering queued until every active tool has completed, without interruption', async () => {
  let emit!: (event: AgentEvent) => void
  const steer = vi.fn(async () => {})
  const interrupt = vi.fn(async () => {})
  const svc = new AgentService(db, () => {}, fakeQuery([]), (_scope, _settings, callback) => {
    emit = callback
    return { start: async () => { emit({ kind: 'state', state: 'running' }) }, send: async () => {}, steer, interrupt, stop: async () => {}, replyPermission: () => {}, replyQuestion: () => {} }
  })
  const session = svc.start('t', scopeOf(cwd), 'initial', { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' })
  emit({ kind: 'tool-use', toolUseId: 'one', name: 'Bash', summary: 'first command' })
  emit({ kind: 'tool-use', toolUseId: 'two', name: 'Bash', summary: 'second command' })
  await svc.submit(session.id, 'change direction', 'steer')
  expect(svc.queued(session.id)).toMatchObject([{ text: 'change direction', mode: 'steer' }])
  expect(steer).not.toHaveBeenCalled()
  emit({ kind: 'tool-result', toolUseId: 'one', isError: false, summary: 'done' }); await Promise.resolve()
  expect(steer).not.toHaveBeenCalled()
  emit({ kind: 'tool-result', toolUseId: 'two', isError: true, summary: 'failed but finished' })
  await until(() => svc.queued(session.id).length === 0)
  expect(steer).toHaveBeenCalledExactlyOnceWith('change direction', undefined)
  expect(interrupt).not.toHaveBeenCalled()
  svc.stop(session.id)
})
