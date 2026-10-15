import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentService, type QueryFn } from '../src/agent'
import { ADVISOR_PREAMBLE, advisorPrompt, claudeAdvisorModel } from '../src/advisor'
import { openDb, type Db } from '../src/db'
import { fakeCodex } from '../src/fakeAgent'
import { adviceMessage, advisorAgentId, advisorTranscript, latestTasks, parseAdvice } from '@ramu/shared/agentTasks'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AppPreferences,
  type FallbackStep,
  type ProviderCatalog,
} from '@ramu/shared/types'

/** Records options and answers each message once. */
function fakeQuery(calls: Options[]): QueryFn {
  return ({ prompt, options }) => {
    calls.push(options)
    async function* run(): AsyncGenerator<SDKMessage, void> {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'provider-1',
        model: 'fake',
        cwd: options.cwd!,
      } as SDKMessage
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
        const text = typeof m.message.content === 'string' ? m.message.content : ''
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: `echo:${text.slice(0, 40)}` }] },
        } as unknown as SDKMessage
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'done',
          total_cost_usd: 0,
        } as unknown as SDKMessage
      }
    }
    return Object.assign(run(), { interrupt: async () => undefined, close: () => undefined }) as unknown as Query
  }
}

const catalog: ProviderCatalog[] = [
  {
    provider: 'claude-code',
    models: [
      {
        provider: 'claude-code',
        id: 'sonnet',
        name: 'Sonnet',
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        isDefault: true,
      },
    ],
  },
  {
    provider: 'codex',
    models: [
      {
        provider: 'codex',
        id: 'codex-test',
        name: 'Codex test',
        efforts: ['low', 'high'],
        defaultEffort: 'high',
        isDefault: true,
      },
    ],
  },
]
const codexStep: FallbackStep = { id: 'a', provider: 'codex', model: 'codex-test', effort: 'high' }
const advisorOn = (patch: Partial<AppPreferences['advisor']> = {}): AppPreferences => ({
  ...DEFAULT_APP_PREFERENCES,
  advisor: { enabled: true, step: codexStep, wait: false, ...patch },
})
const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let db: Db
let tmp: string
let cwd: string
let events: { id: string; event: AgentEvent }[]
beforeEach(() => {
  db = openDb(':memory:')
  events = []
  tmp = mkdtempSync(join(tmpdir(), 'ramu-advisor-'))
  cwd = realpathSync(tmp)
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0);`)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmp, { recursive: true, force: true })
})

function service(calls: Options[] = []) {
  const svc = new AgentService(db, (id, event) => events.push({ id, event }), fakeQuery(calls), fakeCodex)
  vi.spyOn(svc, 'catalog').mockResolvedValue(catalog)
  svc.toolConnection = () => ({ url: 'http://127.0.0.1:9/mcp', token: 't' })
  return svc
}
const scope = () => ({ cwd, additionalDirs: [], covers: [cwd] })
const appended = (options: Options) =>
  typeof options.systemPrompt === 'object' && options.systemPrompt && 'append' in options.systemPrompt
    ? (options.systemPrompt.append ?? '')
    : ''

describe('advisor', () => {
  it('opens delivered advice from old chats that have no advisor task or transcript', () => {
    const text = adviceMessage({
      requestId: 'old-request',
      status: 'ready',
      advisor: 'opus · Claude',
      advice: 'Check the migration.',
    })
    const saved: AgentEvent[] = [{ kind: 'user', text, at: 100 }]
    const agentId = advisorAgentId('old-request')
    expect(latestTasks(saved)).toEqual([
      expect.objectContaining({ agentId, taskType: 'advisor', status: 'completed', summary: 'Check the migration.' }),
    ])
    expect(advisorTranscript(saved, agentId)).toEqual([
      { kind: 'text', text: 'Check the migration.', agentId, at: 100 },
    ])
    const own: AgentEvent[] = [
      { kind: 'agent', agentId, name: 'Advisor', taskType: 'advisor', status: 'completed' },
      { kind: 'text', text: 'Check the migration.', agentId },
    ]
    expect(latestTasks([...own, ...saved])).toHaveLength(1)
    expect(advisorTranscript([...own, ...saved], agentId)).toEqual([own[1]])
  })

  it('recovers failed legacy consultations as errors', () => {
    const saved: AgentEvent[] = [
      { kind: 'user', text: adviceMessage({ requestId: 'old-error', status: 'failed', error: 'Timed out' }) },
    ]
    expect(latestTasks(saved)[0]).toMatchObject({ status: 'failed', error: 'Timed out' })
    expect(advisorTranscript(saved, advisorAgentId('old-error'))[0]).toMatchObject({
      kind: 'error',
      message: 'Timed out',
    })
  })
  it('is off by default', () => {
    expect(DEFAULT_APP_PREFERENCES.advisor).toEqual({ enabled: false, step: null, wait: false })
  })

  it("reads Claude Code's own advisor model from the user settings", () => {
    const dir = join(tmp, 'claude')
    mkdirSync(dir)
    expect(claudeAdvisorModel(dir)).toBeNull()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ advisorModel: 'opus' }))
    expect(claudeAdvisorModel(dir)).toBe('opus')
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ advisorModel: '' }))
    expect(claudeAdvisorModel(dir)).toBeNull()
  })

  it("keeps Claude's own advisor while Ramu's is off, and replaces it while on", async () => {
    const calls: Options[] = []
    const svc = service(calls)
    svc.preferences = () => DEFAULT_APP_PREFERENCES
    const off = svc.start('t', scope(), 'one', { ...DEFAULT_AGENT_SETTINGS, access: 'edits' })
    await until(() => svc.get(off.id).state === 'idle')
    expect(calls[0]!.settings).toBeUndefined()
    expect(appended(calls[0]!)).not.toContain(ADVISOR_PREAMBLE)
    expect(svc.advisorStep(off.id)).toBeNull()

    svc.preferences = () => advisorOn()
    const on = svc.start('t', scope(), 'two', { ...DEFAULT_AGENT_SETTINGS, access: 'edits' })
    await until(() => calls.length === 2)
    expect(calls[1]!.settings).toEqual({ advisorModel: '' })
    expect(appended(calls[1]!)).toContain(ADVISOR_PREAMBLE)
    expect(svc.advisorStep(on.id)).toEqual(codexStep)
    // Consulting the advisor never needs an approval, even with edit-only access.
    const signal = new AbortController().signal
    expect(await calls[1]!.canUseTool!('mcp__ramu__advisor', {}, { signal, toolUseID: 'a' } as never)).toMatchObject({
      behavior: 'allow',
    })
    expect(
      await calls[1]!.canUseTool!('mcp__ramu__wait_for_advice', { requestId: 'x' }, {
        signal,
        toolUseID: 'b',
      } as never),
    ).toMatchObject({ behavior: 'allow' })
    svc.stopAll()
  })

  it('does not give the advisor to sub-agents', () => {
    const svc = service()
    svc.preferences = () => advisorOn()
    const create = (
      svc as unknown as {
        createSession(
          taskId: string,
          scope: unknown,
          settings: unknown,
          state: string,
          parentId?: string | null,
        ): { id: string }
      }
    ).createSession.bind(svc)
    const parent = create('t', scope(), DEFAULT_AGENT_SETTINGS, 'idle')
    const child = create('t', scope(), DEFAULT_AGENT_SETTINGS, 'idle', parent.id)
    expect(svc.advisorStep(parent.id)).toEqual(codexStep)
    expect(svc.advisorStep(child.id)).toBeNull()
  })

  it("turns Claude's own advisor off in background analysis", async () => {
    const calls: Options[] = []
    const svc = service(calls)
    await svc.analyze('commit: summarize', { ...DEFAULT_AGENT_SETTINGS })
    expect(calls[0]!.settings).toEqual({ advisorModel: '' })
  })

  it("builds the prompt from the transcript and the agent's focus", () => {
    const prompt = advisorPrompt('/repo', 'USER: add login', 'Is JWT right here?')
    expect(prompt.startsWith('advisor:')).toBe(true)
    expect(prompt).toContain('<conversation>\nUSER: add login\n</conversation>')
    expect(prompt).toContain('<agent-focus>\nIs JWT right here?\n</agent-focus>')
    expect(advisorPrompt('/repo', 'x')).not.toContain('agent-focus')
  })

  it('answers on another provider, waiting or delivering the advice as a message', async () => {
    vi.stubEnv('RAMU_FAKE_AGENT', '1')
    const svc = service()
    svc.preferences = () => advisorOn()
    const chat = svc.start('t', scope(), 'Plan the login flow', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(chat.id).state === 'idle')

    const waited = await svc.consultAdvisor(chat.id, { focus: 'Is the plan sound?', wait: true })
    expect(waited).toMatchObject({ status: 'ready', advisor: 'codex-test · Codex' })
    expect(waited.advice).toContain('Is the plan sound?')
    expect(await svc.waitForAdvice(chat.id, waited.requestId)).toEqual(waited)

    const pending = await svc.consultAdvisor(chat.id, {})
    expect(pending.status).toBe('pending')
    expect(pending.note).toContain('wait_for_advice')
    await until(() =>
      events.some(
        ({ id, event }) =>
          id === chat.id && event.kind === 'user' && event.text.includes(`request ${pending.requestId}`),
      ),
    )
    // Advice the agent waited for is not delivered a second time.
    expect(
      events.filter(({ event }) => event.kind === 'user' && event.text.includes(`request ${waited.requestId}`)),
    ).toEqual([])
    await expect(svc.waitForAdvice(chat.id, 'unknown')).rejects.toThrow('Unknown advisor request')

    // Each consultation is a card like a sub-agent, with the question and the advice as its own transcript.
    const cards = latestTasks(svc.events(chat.id)).filter((task) => task.taskType === 'advisor')
    expect(cards.map((task) => [task.agentId, task.status, task.background])).toEqual([
      [advisorAgentId(waited.requestId), 'completed', false],
      [advisorAgentId(pending.requestId), 'completed', true],
    ])
    expect(cards[0]).toMatchObject({
      name: 'Advisor',
      provider: 'codex',
      model: 'codex-test',
      summary: waited.advice,
      canMessage: false,
    })
    const own = svc
      .events(chat.id)
      .filter((event) => event.agentId === advisorAgentId(waited.requestId) && event.kind !== 'agent')
    expect(
      own.map((event) => (event.kind === 'user' || event.kind === 'text' ? [event.kind, event.text] : [event.kind])),
    ).toEqual([
      ['user', 'Is the plan sound?'],
      ['text', waited.advice],
    ])
    svc.stopAll()
  })

  it('stops a consultation from its card without delivering advice', async () => {
    vi.stubEnv('RAMU_FAKE_AGENT', '1')
    const svc = service()
    svc.preferences = () => advisorOn()
    const chat = svc.start('t', scope(), 'Work', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(chat.id).state === 'idle')
    let release!: () => void
    const original = svc.analyze.bind(svc)
    vi.spyOn(svc, 'analyze').mockImplementation(async (prompt, settings, max, options) => {
      await new Promise<void>((resolve) => {
        release = resolve
        options?.signal?.addEventListener('abort', () => resolve())
      })
      if (options?.signal?.aborted) throw new Error('Background analysis stopped')
      return original(prompt, settings, max, options)
    })
    const pending = await svc.consultAdvisor(chat.id, {})
    await svc.stopTask(chat.id, advisorAgentId(pending.requestId))
    expect(await svc.waitForAdvice(chat.id, pending.requestId)).toMatchObject({ status: 'failed' })
    release?.()
    expect(svc.task(chat.id, advisorAgentId(pending.requestId))?.status).toBe('stopped')
    await new Promise((r) => setTimeout(r, 50))
    expect(
      events.some(({ event }) => event.kind === 'user' && !event.agentId && event.text.includes(pending.requestId)),
    ).toBe(false)
    svc.stopAll()
  })

  it('does not restart a limited advisor as a sub-agent or name the chat after its question', async () => {
    vi.stubEnv('RAMU_FAKE_AGENT', '1')
    const svc = service()
    svc.preferences = () => advisorOn()
    const chat = svc.start('t', scope(), 'Add login', { ...DEFAULT_AGENT_SETTINGS, access: 'full', autoFallback: true })
    await until(() => svc.get(chat.id).state === 'idle')
    vi.spyOn(svc, 'analyze').mockRejectedValueOnce(new Error('usage_limit_reached'))
    const failed = await svc.consultAdvisor(chat.id, { focus: 'Name me', wait: true })
    expect(failed.status).toBe('failed')
    await new Promise((r) => setTimeout(r, 50))
    expect(latestTasks(svc.events(chat.id)).map((task) => [task.taskType, task.status])).toEqual([
      ['advisor', 'failed'],
    ])
    expect(svc.list('t')).toHaveLength(1)
    vi.mocked(svc.analyze).mockImplementation(async (prompt) => ({
      message: prompt.includes('Name me') ? 'Wrong title' : 'Add login',
      provider: 'codex',
      model: 'codex-test',
    }))
    expect(await svc.draftTitle('t', DEFAULT_AGENT_SETTINGS)).toBe('Add login')
    svc.stopAll()
  })

  it('recognises delivered advice so the chat can show it as a link to the card', () => {
    const ready = adviceMessage({
      requestId: 'r-1',
      status: 'ready',
      advisor: 'opus · Claude',
      advice: 'Check the tests.\n\nThen ship.',
    })
    expect(parseAdvice(ready)).toEqual({
      requestId: 'r-1',
      advisor: 'opus · Claude',
      body: 'Check the tests.\n\nThen ship.',
      failed: false,
    })
    expect(
      parseAdvice(adviceMessage({ requestId: 'r-2', status: 'failed', error: 'Background analysis timed out' })),
    ).toEqual({ requestId: 'r-2', body: 'Background analysis timed out', failed: true })
    expect(parseAdvice('Advice from a friend')).toBeNull()
  })

  it('always waits when the setting asks for it, and refuses when off', async () => {
    vi.stubEnv('RAMU_FAKE_AGENT', '1')
    const svc = service()
    svc.preferences = () => advisorOn({ wait: true })
    const chat = svc.start('t', scope(), 'Work', { ...DEFAULT_AGENT_SETTINGS, access: 'full' })
    await until(() => svc.get(chat.id).state === 'idle')
    expect((await svc.consultAdvisor(chat.id, {})).status).toBe('ready')
    svc.preferences = () => DEFAULT_APP_PREFERENCES
    await expect(svc.consultAdvisor(chat.id, {})).rejects.toThrow('turned off')
    svc.stopAll()
  })
})
