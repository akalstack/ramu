import { afterEach, beforeEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AgentService } from '../src/agent'
import { openDb, type Db } from '../src/db'
import { registerQuestionTools } from '../src/agent/questionTools'
import { DEFAULT_AGENT_SETTINGS, DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'

let db: Db, agents: AgentService, server: McpServer, client: Client, sessionId: string
beforeEach(async () => {
  db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects (id,name,created_at) VALUES ('p','P',0); INSERT INTO tasks (id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',0)",
  )
  agents = new AgentService(
    db,
    () => {},
    () => {
      throw new Error('Unused Claude adapter')
    },
    (_scope, _settings, emit) => ({
      start: async () => {
        emit({ kind: 'state', state: 'running' })
      },
      send: async () => {},
      steer: async () => {},
      stop: async () => {},
      interrupt: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    }),
  )
  sessionId = agents.start('t', { cwd: '/workspace', additionalDirs: [], covers: ['/workspace'] }, 'Do the work', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
    access: 'full',
  }).id
  server = new McpServer({ name: 'question-test', version: '1' })
  registerQuestionTools(server, agents, sessionId)
  client = new Client({ name: 'question-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
})
afterEach(async () => {
  await client.close()
  await server.close()
  await agents.stopAndWait(sessionId)
  db.close()
})
const dataOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0]!.text)

it('exposes grouped questions through MCP without leaking unsent drafts or partial related answers', async () => {
  const tools = await client.listTools()
  expect(tools.tools.map((tool) => tool.name)).toEqual([
    'ask_user',
    'question_status',
    'wait_for_answer',
    'close_question',
  ])
  const asked = dataOf(
    await client.callTool({
      name: 'ask_user',
      arguments: {
        dependsOn: 'Database setup',
        questions: [
          { id: 'db', question: 'Database?' },
          { id: 'region', question: 'Region?' },
        ],
      },
    }),
  )
  const requestId = asked.request.requestId
  expect(asked.request).toMatchObject({ grouping: 'together', responseMode: 'message' })
  agents.saveQuestionDraft(sessionId, requestId, { db: 'Private unfinished choice' })
  const status = dataOf(await client.callTool({ name: 'question_status', arguments: { requestId } }))
  expect(status.answers).toEqual({})
  expect(status).not.toHaveProperty('drafts')
  expect(JSON.stringify(status)).not.toContain('Private unfinished choice')
  expect(() => agents.replyQuestion(sessionId, requestId, { db: 'SQLite' })).toThrow('together')
  const closed = await client.callTool({
    name: 'close_question',
    arguments: { requestId, reason: 'The database is no longer in scope.' },
  })
  expect(closed.isError).not.toBe(true)
  expect(dataOf(await client.callTool({ name: 'question_status', arguments: { requestId } }))).toMatchObject({
    outcome: 'obsolete',
    reason: 'The database is no longer in scope.',
    answers: {},
  })
})

it('rejects a request from another thread and waits for the complete related group over MCP', async () => {
  const missing = await client.callTool({ name: 'question_status', arguments: { requestId: 'another-chats-request' } })
  expect(missing.isError).toBe(true)
  const asked = dataOf(
    await client.callTool({
      name: 'ask_user',
      arguments: {
        questions: [
          { id: 'constructor', question: 'Choice?' },
          { id: '__proto__', question: 'Choice?' },
        ],
      },
    }),
  )
  const requestId = asked.request.requestId
  const waiting = client.callTool({ name: 'wait_for_answer', arguments: { requestId } })
  for (let attempt = 0; agents.get(sessionId).state !== 'needs-input' && attempt < 50; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  expect(agents.get(sessionId).state).toBe('needs-input')
  agents.replyQuestion(
    sessionId,
    requestId,
    Object.fromEntries([
      ['constructor', 'A'],
      ['__proto__', 'B'],
    ]),
  )
  const reply = dataOf(await waiting)
  expect(reply.outcome).toBe('answered')
  expect(Object.entries(reply.answers)).toEqual([
    ['constructor', 'A'],
    ['__proto__', 'B'],
  ])
  expect(reply).not.toHaveProperty('drafts')
  expect(agents.queued(sessionId)).toHaveLength(0)
})

it('cancels a blocking question whose tool call is aborted rather than accepting an undeliverable late reply', async () => {
  const controller = new AbortController()
  const waiting = agents.askQuestion(
    sessionId,
    {
      blocking: true,
      questions: [{ id: 'db', question: 'Database?', header: 'Database', multiSelect: false, options: [] }],
    },
    controller.signal,
  )
  const request = agents.events(sessionId).findLast((event) => event.kind === 'question')!
  const rejected = expect(waiting).rejects.toThrow('cancelled')
  controller.abort()
  await rejected
  expect(agents.questionStatus(sessionId, request.requestId).outcome).toBe('cancelled')
  expect(() => agents.replyQuestion(sessionId, request.requestId, { db: 'SQLite' })).toThrow('closed')
})

const toolNames = async (id: string) => {
  const probe = new McpServer({ name: 'question-test-probe', version: '1' })
  registerQuestionTools(probe, agents, id)
  const probeClient = new Client({ name: 'question-test-probe', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await probe.connect(serverTransport)
  await probeClient.connect(clientTransport)
  try {
    return (await probeClient.listTools()).tools.map((tool) => tool.name)
  } finally {
    await probeClient.close()
    await probe.close()
  }
}
const startPinned = async (asyncQuestions: boolean, cwd: string) => {
  agents.preferences = () => ({ ...DEFAULT_APP_PREFERENCES, asyncQuestions })
  agents.toolConnection = () => ({ url: 'http://127.0.0.1:9/mcp', token: 't' })
  const id = agents.start('t', { cwd, additionalDirs: [], covers: [cwd] }, 'Do the work', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
    access: 'full',
  }).id
  await new Promise((resolve) => setTimeout(resolve, 0))
  return id
}

it('keeps the question tools a chat launched with when the async setting changes later', async () => {
  const asyncChat = await startPinned(true, '/workspace-a')
  agents.preferences = () => ({ ...DEFAULT_APP_PREFERENCES, asyncQuestions: false })
  expect(await toolNames(asyncChat)).toEqual(['ask_user', 'question_status', 'wait_for_answer', 'close_question'])
  const blockingChat = await startPinned(false, '/workspace-b')
  agents.preferences = () => ({ ...DEFAULT_APP_PREFERENCES, asyncQuestions: true })
  expect(await toolNames(blockingChat)).toEqual(['ask_user'])
  await agents.stopAndWait(asyncChat)
  await agents.stopAndWait(blockingChat)
})

it.each([undefined, []])('waits for an explicit typed answer when options are %j', async (options) => {
  const waiting = client.callTool({
    name: 'ask_user',
    arguments: {
      blocking: true,
      dependsOn: 'The user’s description of the problem',
      questions: [
        { id: 'details', question: 'What happened, and what did you expect?', ...(options ? { options } : {}) },
      ],
    },
  })
  for (let attempt = 0; agents.get(sessionId).state !== 'needs-input' && attempt < 50; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  expect(agents.get(sessionId).state).toBe('needs-input')
  const request = agents.events(sessionId).findLast((event) => event.kind === 'question')!
  expect(request.questions[0]!.options).toEqual([])
  const requestId = request.requestId
  agents.saveQuestionDraft(sessionId, requestId, { details: 'Unsubmitted details' })
  expect(() => agents.replyQuestion(sessionId, requestId, {})).toThrow('Answer an unanswered question')
  expect(() => agents.replyQuestion(sessionId, requestId, { details: ' \n ' })).toThrow('Answer an unanswered question')
  const pending = agents.questionStatus(sessionId, requestId)
  expect(pending.answers).toEqual({})
  expect(pending.outcome).toBeUndefined()
  expect(pending.waiting).toBe(true)
  expect(agents.get(sessionId).state).toBe('needs-input')
  agents.replyQuestion(sessionId, requestId, { details: '  The app closed instead of saving.  ' })
  const result = dataOf(await waiting)
  expect(result).toMatchObject({ outcome: 'answered', answers: { details: 'The app closed instead of saving.' } })
  expect(result).not.toHaveProperty('drafts')
})
