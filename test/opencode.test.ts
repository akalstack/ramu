import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createOpenCodeRunner, openCodeModels, openCodeModel, openCodePermissions } from '../src/main/opencode'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '../src/shared/types'

const mock = vi.hoisted(() => ({ close: vi.fn(async () => {}), client: {} as any, deliver: (_event: any) => {}, finish: () => {}, events: [] as any[] }))
vi.mock('../src/main/opencodeServer', () => ({ startOpenCodeServer: vi.fn(async () => ({ url: 'http://127.0.0.1:1234', headers: { Authorization: 'Basic test' }, close: mock.close })) }))
vi.mock('@opencode-ai/sdk/v2', () => ({ createOpencodeClient: vi.fn(() => mock.client) }))
let events: AgentEvent[]
let runner: ReturnType<typeof createOpenCodeRunner> | undefined
const until = async (test: () => boolean) => { const start = Date.now(); while (!test()) { if (Date.now() - start > 3000) throw new Error('Timed out'); await new Promise((r) => setTimeout(r, 5)) } }
beforeEach(() => {
  events = []; mock.events = []; vi.clearAllMocks()
  mock.client = {
    v2: { model: { list: vi.fn(async () => ({ response: { ok: false, status: 404 } })) } },
    provider: { list: vi.fn(async () => ({ data: { connected: ['test'], default: { test: 'model' }, all: [{ id: 'test', name: 'Test', models: { model: { id: 'model', name: 'Model' } } }, { id: 'offline', models: { other: { id: 'other' } } }] } })) },
    session: {
      create: vi.fn(async () => ({ data: { id: 'session' } })),
      get: vi.fn(async () => ({ data: { id: 'session', directory: '/workspace' } })),
      update: vi.fn(async () => ({})),
      prompt: vi.fn(() => new Promise((resolve) => { mock.finish = () => resolve({ data: { info: { cost: 0.01 }, parts: [] } }) })),
      abort: vi.fn(async () => { mock.finish(); return {} }),
    },
    event: { subscribe: vi.fn(async (_params, options) => {
      let waiter: ((value: any) => void) | undefined
      let ended = false
      const queue: any[] = []
      mock.deliver = (event) => { if (waiter) { const next = waiter; waiter = undefined; next({ value: event, done: false }) } else queue.push(event) }
      options.signal.addEventListener('abort', () => { ended = true; waiter?.({ done: true }) })
      return { stream: { [Symbol.asyncIterator]: () => ({ next: () => queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : ended ? Promise.resolve({ done: true }) : new Promise((resolve) => { waiter = resolve }) }) } }
    }) },
    permission: { reply: vi.fn(async () => ({})) },
    question: { reply: vi.fn(async () => ({})), reject: vi.fn(async () => ({})) },
    mcp: { add: vi.fn(async () => ({})) },
  }
})
afterEach(async () => { await runner?.stop(); runner = undefined })
const start = async (resume: string | null = null, readOnly = false) => {
  runner = createOpenCodeRunner({ cwd: '/workspace', covers: ['/workspace'], additionalDirs: [] }, { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', model: 'test/model', access: 'ask' }, (event) => events.push(event), readOnly)
  await runner.start('hello', resume)
}
it('discovers only connected provider models and releases its server', async () => {
  expect(await openCodeModels()).toEqual([{ provider: 'opencode', id: 'test/model', name: 'Model · Test', efforts: [], defaultEffort: null, isDefault: true }])
  expect(mock.close).toHaveBeenCalledOnce()
})
it('splits provider/model IDs without truncating model paths', () => {
  expect(openCodeModel('provider/model/version')).toEqual({ providerID: 'provider', modelID: 'model/version' })
  expect(() => openCodeModel('model')).toThrow('provider/model')
})
it('maps access modes to OpenCode permission rules with read-only taking priority', () => {
  expect(openCodePermissions({ ...DEFAULT_AGENT_SETTINGS, access: 'edits' }, false)).toContainEqual({ permission: 'edit', pattern: '*', action: 'allow' })
  expect(openCodePermissions(DEFAULT_AGENT_SETTINGS, true).every((r) => r.action === 'deny')).toBe(true)
})
it('resumes in the same workspace and reapplies access rules', async () => {
  await start('session')
  expect(mock.client.session.create).not.toHaveBeenCalled()
  expect(mock.client.session.update).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'session', permission: expect.any(Array) }), expect.anything())
  expect(mock.client.session.prompt.mock.calls[0][0].model).toEqual({ providerID: 'test', modelID: 'model' })
})
it('streams assistant text while ignoring user message parts and unrelated sessions', async () => {
  await start()
  const send = (type: string, properties: any) => mock.deliver({ type, properties: { sessionID: 'session', ...properties } })
  send('message.updated', { info: { id: 'user', role: 'user' } })
  send('message.part.updated', { part: { id: 'u', messageID: 'user', type: 'text', text: 'hello' } })
  send('message.updated', { info: { id: 'assistant', role: 'assistant' } })
  send('message.part.updated', { part: { id: 'a', messageID: 'assistant', type: 'text', text: 'Hello' } })
  send('message.part.delta', { messageID: 'assistant', partID: 'a', field: 'text', delta: ' world' })
  send('message.part.updated', { sessionID: 'other', part: { id: 'x', messageID: 'assistant', type: 'text', text: 'wrong' } })
  await until(() => events.filter((e) => e.kind === 'text').length === 2)
  expect(events.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Hello', 'Hello world'])
  mock.finish(); await until(() => events.some((e) => e.kind === 'result'))
})
it('routes permissions and questions through SDK responses', async () => {
  await start()
  mock.deliver({ type: 'permission.asked', properties: { sessionID: 'session', id: 'permission', permission: 'bash', patterns: ['pwd'] } })
  await until(() => events.some((e) => e.kind === 'permission-request'))
  runner!.replyPermission('permission', false)
  await until(() => events.some((e) => e.kind === 'request-resolved'))
  expect(mock.client.permission.reply).toHaveBeenCalledWith({ requestID: 'permission', reply: 'reject' }, expect.anything())
  mock.deliver({ type: 'question.asked', properties: { sessionID: 'session', id: 'question', questions: [{ header: 'Choice', question: 'Which?', multiple: false, options: [{ label: 'First', description: '' }] }] } })
  await until(() => events.some((e) => e.kind === 'question'))
  runner!.replyQuestion('question', { 'Which?': 'First' })
  await until(() => mock.client.question.reply.mock.calls.length === 1)
  expect(mock.client.question.reply.mock.calls[0][0]).toEqual({ requestID: 'question', answers: [['First']] })
})
it('aborts active work before closing its server', async () => {
  await start(); await runner!.stop()
  expect(mock.client.session.abort).toHaveBeenCalled()
  expect(mock.close).toHaveBeenCalled()
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})
it('uses native SDK v2 model discovery when advertised', async () => {
  mock.client.v2.model.list.mockResolvedValue({ response: { ok: true, status: 200 }, data: { data: [{ providerID: 'test', id: 'native', name: 'Native', enabled: true, status: 'active' }, { providerID: 'test', id: 'disabled', enabled: false }] } })
  expect(await openCodeModels()).toEqual([{ provider: 'opencode', id: 'test/native', name: 'Native', efforts: [], defaultEffort: null, isDefault: true }])
  expect(mock.client.provider.list).not.toHaveBeenCalled()
})
it('uses SDK v2 session, prompt, wait, and interrupt calls', async () => {
  mock.client.v2.model.list.mockResolvedValue({ response: { ok: true, status: 200 } })
  mock.client.v2.agent = { list: vi.fn(async () => ({ data: { data: [] } })) }
  mock.client.v2.event = { subscribe: vi.fn((options) => mock.client.event.subscribe({}, options)) }
  mock.client.v2.session = {
    create: vi.fn(async () => ({ data: { data: { id: 'session' } } })),
    prompt: vi.fn(async () => ({})),
    wait: vi.fn(() => new Promise((resolve) => { mock.finish = () => resolve({}) })),
    interrupt: vi.fn(async () => { mock.finish(); return {} }),
  }
  await start(); await until(() => mock.client.v2.session.wait.mock.calls.length === 1)
  expect(mock.client.v2.session.create.mock.calls[0][0]).toEqual({ location: { directory: '/workspace' }, model: { providerID: 'test', id: 'model' } })
  expect(mock.client.v2.session.prompt.mock.calls[0][0].prompt.text).toBe('hello')
  mock.deliver({ type: 'session.next.text.delta', data: { sessionID: 'session', textID: 'native-text', delta: 'Native' } })
  await until(() => events.some((e) => e.kind === 'text'))
  await runner!.interrupt()
  expect(events).toContainEqual(expect.objectContaining({ kind: 'result', isError: false }))
})
