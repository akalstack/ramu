import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type AgentTask } from '@ramu/shared/types'
import { holdsTurn } from '@ramu/shared/chat/helperPresentation'
import { AgentService } from '../src/agent'
import { registerBackgroundWaitTools } from '../src/agent/backgroundWaitTools'
import { sessionGuidance } from '../src/agent/guidance'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { mcpCallSkipsCard } from '../src/agent/toolApprovals'
import { openDb, type Db } from '../src/db'
import { fakeQuery } from '../src/providers/fakeAgent'

let db: Db
let tmp: string
let svc: AgentService
const cleanup: (() => Promise<void>)[] = []
beforeEach(() => {
  db = openDb(':memory:')
  tmp = mkdtempSync(join(tmpdir(), 'ramu-background-wait-'))
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0);
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0),
           ('t2', 'p', 'T2', 'current', 'idle', 0);`)
  svc = new AgentService(db, () => {}, fakeQuery)
})
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  svc.stopAll()
  db.close()
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function thread(taskId: string) {
  const cwd = realpathSync(tmp)
  const session = svc.start(taskId, { cwd, additionalDirs: [], covers: [cwd] }, 'hello', DEFAULT_AGENT_SETTINGS)
  await until(() => svc.get(session.id).state === 'idle')
  return session
}
const update = (sessionId: string, agentId: string, patch: Partial<AgentTask>) =>
  (svc as unknown as { updateTask(id: string, agentId: string, patch: Partial<AgentTask>): void }).updateTask(
    sessionId,
    agentId,
    patch,
  )
const command = (sessionId: string, agentId: string, patch: Partial<AgentTask> = {}) =>
  update(sessionId, agentId, {
    name: 'pnpm test',
    taskType: 'local_bash',
    status: 'running',
    background: true,
    address: agentId,
    ...patch,
  })

/** The tool as one session's connection sees it, listed beside a deferred catalog. */
async function tool(sessionId: string) {
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const registry = new ToolRegistry(server, true)
  registerBackgroundWaitTools(registry.server, (taskIds, waiting) => svc.awaitCommands(sessionId, taskIds, waiting))
  registry.expose()
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  cleanup.push(async () => {
    await client.close()
    await server.close()
  })
  return {
    client,
    call: async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: 'background_wait', arguments: args })
      const [content] = result.content as { text: string }[]
      return {
        isError: result.isError === true,
        value: result.isError ? null : (JSON.parse(content!.text) as { matched: string[]; unmatched: string[] }),
      }
    },
  }
}

it('marks the thread own running commands by task id, address or tool call, and says which ids matched nothing', async () => {
  const session = await thread('t')
  command(session.id, 'b9cun1cat')
  command(session.id, 'task-2', { address: 'shell-2' })
  command(session.id, 'task-3', { toolUseId: 'toolu_3' })
  command(session.id, 'ended', { status: 'completed' })
  update(session.id, 'reviewer', { name: 'Reviewer', status: 'running' })
  const { call, client } = await tool(session.id)
  // Always in view: an agent calls it as its reply ends.
  expect((await client.listTools()).tools.map((entry) => entry.name)).toContain('background_wait')
  expect((await call({ taskIds: ['b9cun1cat', 'shell-2', 'toolu_3', 'ended', 'reviewer', 'nope'] })).value).toEqual({
    matched: ['b9cun1cat', 'shell-2', 'toolu_3'],
    unmatched: ['ended', 'reviewer', 'nope'],
  })
  for (const agentId of ['b9cun1cat', 'task-2', 'task-3']) {
    expect(svc.task(session.id, agentId), agentId).toMatchObject({ awaited: true, status: 'running' })
    expect(holdsTurn(svc.task(session.id, agentId)!)).toBe(true)
  }
  expect(svc.task(session.id, 'ended')?.awaited).toBeUndefined()
  expect(svc.task(session.id, 'reviewer')?.awaited).toBeUndefined()
  // The thread counts as working while the agent waits, as it does for a sub-agent.
  update(session.id, 'reviewer', { status: 'completed' })
  expect(svc.helperSummaries('t').get('t')).toEqual({ active: 3, waiting: 0 })

  expect((await call({ taskIds: ['shell-2', 'toolu_3'], waiting: false })).value).toEqual({
    matched: ['shell-2', 'toolu_3'],
    unmatched: [],
  })
  expect(svc.task(session.id, 'task-2')?.awaited).toBeUndefined()
  expect(svc.task(session.id, 'task-2')?.status).toBe('running')
  expect(svc.helperSummaries('t').get('t')).toEqual({ active: 1, waiting: 0 })
})

it('cannot mark a command that belongs to another thread', async () => {
  const mine = await thread('t')
  const other = await thread('t2')
  command(other.id, 'theirs')
  const { call } = await tool(mine.id)
  expect((await call({ taskIds: ['theirs'] })).value).toEqual({ matched: [], unmatched: ['theirs'] })
  expect(svc.task(other.id, 'theirs')?.awaited).toBeUndefined()
  expect(svc.helperSummaries('t2').has('t2')).toBe(false)
})

it('stops holding the thread when the command ends, the person interrupts the turn or the session stops', async () => {
  const session = await thread('t')
  for (const agentId of ['tests', 'build', 'lint']) command(session.id, agentId)
  const { call } = await tool(session.id)
  await call({ taskIds: ['tests', 'build', 'lint'] })

  update(session.id, 'tests', { status: 'completed', endedAt: Date.now() })
  expect(holdsTurn(svc.task(session.id, 'tests')!)).toBe(false)
  expect(svc.helperSummaries('t').get('t')?.active).toBe(2)

  await svc.interrupt(session.id)
  expect(svc.task(session.id, 'build')).toMatchObject({ status: 'running' })
  expect(svc.task(session.id, 'build')?.awaited).toBeUndefined()
  expect(svc.helperSummaries('t').has('t')).toBe(false)

  await call({ taskIds: ['lint'] })
  svc.stop(session.id)
  expect(svc.task(session.id, 'lint')?.status).toBe('stopped')
  expect(svc.task(session.id, 'lint')?.awaited).toBeUndefined()
  // A command restored from provider history has no process behind it and never holds the turn.
  expect(
    holdsTurn({ agentId: 'x', name: 'x', taskType: 'local_bash', status: 'running', awaited: true, recovered: true }),
  ).toBe(false)
})

it('bounds its input and never raises an approval card', async () => {
  const session = await thread('t')
  const { call } = await tool(session.id)
  expect((await call({ taskIds: [] })).isError).toBe(true)
  expect((await call({ taskIds: Array.from({ length: 21 }, (_, n) => `id-${n}`) })).isError).toBe(true)
  expect((await call({ taskIds: ['x'.repeat(201)] })).isError).toBe(true)
  for (const access of ['edits', 'auto', 'full'] as const) {
    expect(mcpCallSkipsCard(access, 'ramu', 'background_wait'), access).toBe(true)
    expect(mcpCallSkipsCard(access, 'ramu', 'tool_invoke', { name: 'background_wait', arguments: {} })).toBe(true)
  }
})

it('tells the agent about the wait only where its provider reports background commands', () => {
  const sections = {
    questions: 'native' as const,
    background: true,
    advisor: false,
    goal: null,
    nativeSubagentNote: false,
    memory: undefined,
    toolSearch: false,
    learning: undefined,
  }
  expect(sessionGuidance(sections)).not.toContain('background_wait')
  expect(sessionGuidance({ ...sections, backgroundWait: true })).toContain('background_wait')
})

it('marks where a background command finished or failed, once, and not one that was stopped', async () => {
  const session = await thread('t')
  command(session.id, 'build')
  command(session.id, 'lint', { name: 'pnpm lint' })
  command(session.id, 'dev', { name: 'pnpm dev' })
  ;(svc as unknown as { record(id: string, event: AgentEvent): void }).record(session.id, {
    kind: 'text',
    text: 'Waiting on them.',
  })
  update(session.id, 'build', { status: 'completed' })
  update(session.id, 'build', { status: 'completed', summary: 'done' })
  update(session.id, 'lint', { status: 'failed' })
  update(session.id, 'dev', { status: 'stopped' })
  const events = svc.events(session.id)
  const ends = events.filter((event) => event.kind === 'background-command-end')
  expect(ends).toMatchObject([
    { command: 'pnpm test', failed: false },
    { command: 'pnpm lint', failed: true },
  ])
  // Recorded where they ended, after what the agent said meanwhile; the tasks themselves stay where they started.
  const said = events.findIndex((event) => event.kind === 'text' && event.text === 'Waiting on them.')
  expect(events.indexOf(ends[0]!)).toBeGreaterThan(said)
  expect(events.findIndex((event) => event.kind === 'agent')).toBeLessThan(said)
})

it('captures a turn’s changes when it ends, past a background command still running, but waits for a sub-agent', async () => {
  const session = await thread('t')
  const completed: number[] = []
  svc.reviewHooks = {
    begin: async () => 'r',
    bind: () => {},
    abandon: () => {},
    followup: async () => {},
    complete: async () => {
      completed.push(Date.now())
    },
  }
  const parts = svc as unknown as { parts: { recorder: { setState(id: string, state: string): void } } }
  const registry = (
    svc as unknown as { parts: { registry: { live: Map<string, unknown>; finalizing: Map<string, unknown> } } }
  ).parts.registry
  const added = !registry.live.has(session.id)
  if (added) registry.live.set(session.id, {})
  // A dev server left running in the background, as T3 Code lets a turn end with one.
  command(session.id, 'dev', { name: 'pnpm dev' })
  parts.parts.recorder.setState(session.id, 'idle')
  await until(() => completed.length === 1)
  // A sub-agent may still be editing files, so its turn's changes wait for it.
  update(session.id, 'helper', { name: 'Map auth', taskType: 'local_agent', status: 'running' })
  parts.parts.recorder.setState(session.id, 'running')
  parts.parts.recorder.setState(session.id, 'idle')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(completed).toHaveLength(1)
  update(session.id, 'helper', { status: 'completed' })
  await until(() => completed.length === 2)
  // The dev server is still running all along.
  expect(svc.task(session.id, 'dev')?.status).toBe('running')
  await until(() => registry.finalizing.size === 0)
  if (added) registry.live.delete(session.id)
  // Shutting down would capture once more, after the database has closed.
  svc.reviewHooks = undefined
})
