import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentService, type QueryFn } from '../src/agent'
import { openDb, type Db } from '../src/db'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AppPreferences,
} from '@ramu/shared/types'
import type { IdleCompactionMode } from '@ramu/shared/chat/idleCompaction'

/** A Claude stand-in: each message is one request with the given context, `/compact` compacts, `return` raises Claude's return prompt. */
function claude(contextTokens: number, sent: string[]): QueryFn {
  return ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    async function* run(): AsyncGenerator<SDKMessage, void> {
      yield { type: 'system', subtype: 'init', session_id: 'p1', model: 'fake', cwd: options.cwd! } as SDKMessage
      for await (const m of prompt) {
        const text = m.message.content as string
        sent.push(text)
        if (text === '/compact') {
          yield { type: 'system', subtype: 'status', status: 'compacting', uuid: 'u1', session_id: 'p1' } as never
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: { trigger: 'manual', pre_tokens: contextTokens, post_tokens: 30_000 },
            uuid: `boundary-${sent.length}`,
            session_id: 'p1',
          } as SDKMessage
          yield { type: 'result', subtype: 'success', is_error: false, result: '', total_cost_usd: 0 } as never
          continue
        }
        if (text === 'return') {
          const choice = await options.onUserDialog!(
            { dialogKind: 'resume_return', payload: { sessionAgeMinutes: 125, estimatedTokens: 180_000 } },
            { signal: new AbortController().signal, requestId: 'r1' },
          )
          sent.push(`dialog:${JSON.stringify(choice)}`)
        }
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: { type: 'message_start', message: { id: `m${sent.length}` } },
        } as never
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [{ type: 'text', text: `echo:${text}` }],
            usage: {
              input_tokens: 10,
              output_tokens: 90,
              cache_read_input_tokens: contextTokens - 100,
              cache_creation_input_tokens: 0,
              cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 0 },
            },
          },
        } as never
        yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 } as never
      }
    }
    return Object.assign(run(), { interrupt: async () => undefined }) as unknown as Query
  }
}

const until = async (cond: () => boolean, ms = 5000) => {
  const start = performance.now()
  while (!cond()) {
    if (performance.now() - start > ms) throw new Error('timed out')
    await vi.advanceTimersByTimeAsync(10)
  }
}

let db: Db
let tmp: string
let cwd: string
let states: string[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  db = openDb(':memory:')
  tmp = mkdtempSync(join(tmpdir(), 'ramu-idle-'))
  cwd = realpathSync(tmp)
  states = []
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0);`)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(tmp, { recursive: true, force: true })
})

function service(mode: IdleCompactionMode, contextTokens: number, sent: string[], saved: AppPreferences[] = []) {
  let preferences: AppPreferences = { ...DEFAULT_APP_PREFERENCES, idleCompaction: mode }
  const svc = new AgentService(
    db,
    (_id, event: AgentEvent) => {
      if (event.kind === 'state') states.push(event.state)
    },
    claude(contextTokens, sent),
  )
  svc.preferences = () => preferences
  svc.savePreferences = (next) => {
    preferences = next
    saved.push(next)
  }
  return svc
}

const scope = () => ({ cwd, additionalDirs: [], covers: [cwd] })
const compactions = (svc: AgentService, id: string) =>
  svc.events(id).flatMap((e) => (e.kind === 'compaction' ? [{ state: e.state, trigger: e.trigger }] : []))

it('compacts a large idle thread once, shortly before its cache expires, without starting a run', async () => {
  const sent: string[] = []
  const svc = service('beforeCacheExpires', 250_000, sent)
  const session = svc.start('t', scope(), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
  await until(() => svc.get(session.id).state === 'idle')
  const statesBefore = states.length
  // The 5-minute cache of the last request expires at 5:00; nothing goes out before 3:00.
  await vi.advanceTimersByTimeAsync(2 * 60_000 + 50_000)
  expect(sent).toEqual(['hello'])
  await vi.advanceTimersByTimeAsync(20_000)
  await until(() => compactions(svc, session.id).some((c) => c.state === 'completed'))
  expect(sent).toEqual(['hello', '/compact'])
  expect(compactions(svc, session.id)).toEqual([
    { state: 'started', trigger: 'idle' },
    { state: 'completed', trigger: 'idle' },
  ])
  // No user message in the transcript and no run: the thread stays idle, so nothing notifies.
  expect(svc.events(session.id).filter((e) => e.kind === 'user')).toHaveLength(1)
  expect(states.slice(statesBefore).filter((s) => s !== 'idle')).toEqual([])
  expect(svc.get(session.id).state).toBe('idle')
  // The compaction's own end arms nothing: one compaction per idle spell.
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(sent).toEqual(['hello', '/compact'])
  svc.stop(session.id)
})

it('leaves a small thread, or one set to ask on return, as it is', async () => {
  for (const [mode, tokens] of [
    ['beforeCacheExpires', 150_000],
    ['onReturn', 250_000],
    ['off', 250_000],
  ] as const) {
    const sent: string[] = []
    const svc = service(mode, tokens, sent)
    const session = svc.start('t', scope(), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(session.id).state === 'idle')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(sent).toEqual(['hello'])
    svc.stop(session.id)
  }
})

it('a new message before the window re-arms from that turn instead', async () => {
  const sent: string[] = []
  const svc = service('beforeCacheExpires', 250_000, sent)
  const session = svc.start('t', scope(), 'hello', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
  await until(() => svc.get(session.id).state === 'idle')
  await vi.advanceTimersByTimeAsync(2 * 60_000)
  await svc.send(session.id, 'again')
  await until(() => svc.get(session.id).state === 'idle' && sent.length === 2)
  // The first turn's window (3:00) has passed without a compaction; the second turn's opens at 5:00.
  await vi.advanceTimersByTimeAsync(2 * 60_000)
  expect(sent).toEqual(['hello', 'again'])
  await vi.advanceTimersByTimeAsync(60_000 + 100)
  await until(() => sent.includes('/compact'))
  expect(sent).toEqual(['hello', 'again', '/compact'])
  svc.stop(session.id)
})

it("asks in the thread when Claude offers to compact on return, and Don't ask again turns it off in Settings", async () => {
  const sent: string[] = []
  const saved: AppPreferences[] = []
  const svc = service('onReturn', 120_000, sent, saved)
  const session = svc.start('t', scope(), 'return', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
  await until(() => svc.get(session.id).state === 'needs-input')
  const question = svc.events(session.id).find((e) => e.kind === 'question')
  if (question?.kind !== 'question') throw new Error('no question')
  expect(question.questions[0]!.question).toBe(
    'This thread was last active 2h 5m ago and holds about 180,000 tokens. Compact it before continuing?',
  )
  expect(question.questions[0]!.options.map((o) => o.label)).toEqual([
    'Compact and continue',
    'Keep full history',
    "Don't ask again",
  ])
  svc.replyQuestion(session.id, question.requestId, { [question.questions[0]!.question]: "Don't ask again" })
  await until(() => svc.get(session.id).state === 'idle')
  expect(sent).toContain(`dialog:${JSON.stringify({ behavior: 'completed', result: 'continue' })}`)
  expect(saved.map((p) => p.idleCompaction)).toEqual(['off'])
  // Off answers Claude without asking.
  await svc.send(session.id, 'return')
  await until(() => svc.get(session.id).state === 'idle' && sent.filter((s) => s.startsWith('dialog:')).length === 2)
  expect(svc.events(session.id).filter((e) => e.kind === 'question')).toHaveLength(1)
  svc.stop(session.id)
})

it('labels the compaction the person chose on return', async () => {
  const sent: string[] = []
  const svc = service('beforeCacheExpires', 120_000, sent)
  const session = svc.start('t', scope(), 'return', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
  await until(() => svc.get(session.id).state === 'needs-input')
  const question = svc.events(session.id).find((e) => e.kind === 'question')
  if (question?.kind !== 'question') throw new Error('no question')
  // Asking again belongs in Settings while idle compaction is on.
  expect(question.questions[0]!.options.map((o) => o.label)).not.toContain("Don't ask again")
  svc.replyQuestion(session.id, question.requestId, { [question.questions[0]!.question]: 'Compact and continue' })
  await until(() => svc.get(session.id).state === 'idle')
  expect(sent).toContain(`dialog:${JSON.stringify({ behavior: 'completed', result: 'compact' })}`)
  // Claude compacts inside that turn; this stand-in models it with a /compact the person sends.
  await svc.send(session.id, '/compact')
  await until(() => compactions(svc, session.id).some((c) => c.state === 'completed'))
  expect(compactions(svc, session.id).at(-1)).toEqual({ state: 'completed', trigger: 'resume' })
  svc.stop(session.id)
})
