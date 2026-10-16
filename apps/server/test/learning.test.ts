import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_INTELLIGENCE_PREFERENCES,
  type AgentEvent,
  type AgentSessionInfo,
} from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { MemoryService } from '../src/memory/memory'
import type { AgentService } from '../src/agent'
import { LearningService } from '../src/memory/learning'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolRegistry } from '../src/agent/toolRegistry'

let db: Db, root: string, workspace: Workspace, memory: MemoryService, service: LearningService
let trace: AgentEvent[], analyze: ReturnType<typeof vi.fn<AgentService['analyze']>>
const session = {
  id: 's',
  taskId: 't',
  parentId: null,
  state: 'idle',
  provider: 'codex',
  settings: DEFAULT_AGENT_SETTINGS,
} as AgentSessionInfo
const proposal = {
  checkpoint: 'Fixed retries; the integration suite still needs to run.',
  memories: [
    {
      kind: 'feedback',
      title: 'Retry rate-limited calls',
      content: 'Use bounded backoff for rate-limited calls; verified against a simulated 429 response.',
      tags: [],
      importance: 3,
      reason: 'Verified tool result in the source turn',
    },
  ],
  skills: [
    {
      name: 'rate-limit-retry',
      description: 'Handle rate limits with bounded retries',
      content: 'Check the reset time. Bound retries. Verify with a simulated 429.',
      reason: 'A repeatable verified workflow',
    },
  ],
  archive: [],
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-learning-'))
  db = openDb(':memory:')
  workspace = new Workspace(db, join(root, 'worktrees'))
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES ('p','Project',1); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES ('t','p','Task','current','idle',1); INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES ('s','t','codex','/tmp','idle',1), ('other','t','codex','/tmp','stopped',1)",
  )
  trace = [
    { kind: 'user', text: 'Fix retries' },
    { kind: 'tool-use', toolUseId: 'test', name: 'shell', summary: 'run retry tests' },
    { kind: 'tool-result', toolUseId: 'test', isError: false, summary: '429 simulation passed' },
    { kind: 'text', text: 'Fixed retries; integration tests remain.' },
    { kind: 'result', isError: false, text: 'done', costUsd: null },
  ]
  analyze = vi.fn<AgentService['analyze']>(async () => ({
    message: JSON.stringify(proposal),
    provider: 'codex',
    model: 'test',
  }))
  workspace.setAppState('app-preferences', {
    intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'review' },
  })
  const agents = { get: () => session, events: () => trace, analyze }
  memory = new MemoryService(db, workspace, { analyze, list: () => [] }, () => {})
  service = new LearningService(db, workspace, agents, memory, join(root, 'skills'), () => {})
})
afterEach(async () => {
  await service.settle()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

it('skips a connectivity test with an incidental status check without spending a review', async () => {
  trace = [
    { kind: 'user', text: 'test' },
    { kind: 'tool-use', toolUseId: 'status', name: 'shell', summary: 'git status' },
    { kind: 'tool-result', toolUseId: 'status', isError: false, summary: 'Modified files exist' },
    { kind: 'result', isError: false, text: 'Ready', costUsd: null },
  ]
  await service.tick(true)
  expect(service.jobs()).toEqual([])
  expect(analyze).not.toHaveBeenCalled()
  expect(service.checkpoint('s')).toBeNull()
})

it('does not reuse earlier tool calls to review a later acknowledgement', async () => {
  trace.push(
    { kind: 'user', text: 'Thanks' },
    { kind: 'result', isError: false, text: 'You are welcome', costUsd: null },
  )
  await service.tick(true)
  expect(service.jobs()).toEqual([])
  expect(analyze).not.toHaveBeenCalled()
})

it('allows a real testing workflow with a short request and leaves checkpoints thread-local', async () => {
  trace[0] = { kind: 'user', text: 'test' }
  trace.splice(1, 0, { kind: 'tool-use', toolUseId: 'inspect', name: 'shell', summary: 'Inspect retry implementation' })
  await service.tick(true)
  service.apply(service.jobs()[0]!.id)
  expect(service.checkpoint('s')?.summary).toContain('integration suite')
  expect(service.checkpoint('other')).toBeNull()
})

it('can save durable learning without creating a checkpoint when there is no progress to preserve', async () => {
  analyze.mockResolvedValue({
    provider: 'codex',
    model: 'test',
    message: JSON.stringify({ ...proposal, checkpoint: '' }),
  })
  await service.tick(true)
  expect(analyze.mock.calls[0]![0]).toContain('Return an empty checkpoint')
  service.apply(service.jobs()[0]!.id)
  expect(service.checkpoint('s')).toBeNull()
  expect(memory.active('p')).toHaveLength(1)
})

it('stages durable learning, deduplicates a completed turn across restart and applies source-linked changes', async () => {
  const job = service.enqueue('s')!
  expect(service.enqueue('s')).toBeNull()
  await service.tick(true)
  expect(service.jobs().find((entry) => entry.id === job.id)?.status).toBe('pending')
  expect(memory.active('p')).toEqual([])
  expect(service.skills()).toEqual([])
  const restarted = new LearningService(
    db,
    workspace,
    { get: () => session, events: () => trace, analyze },
    memory,
    join(root, 'skills'),
    () => {},
  )
  expect(restarted.enqueue('s')).toBeNull()
  restarted.apply(job.id)
  expect(memory.active('p')[0]?.source).toMatchObject({ sessionId: 's', eventSeq: trace.length })
  expect(restarted.checkpoint('s')?.summary).toContain('still needs to run')
  const skill = restarted.skills()[0]!
  expect(readFileSync(join(root, 'skills', skill.id, 'SKILL.md'), 'utf8')).toContain('bounded retries')
  expect(() => restarted.apply(job.id)).toThrow('No pending')
  restarted.control(skill.id, 'pin')
  restarted.control(skill.id, 'archive')
  restarted.revert(skill.id, 1)
  expect(restarted.skills()[0]?.status).toBe('active')
  await restarted.settle()
})

it('refuses cancelled turns and honors the daily review budget even after a proposal is dismissed', async () => {
  trace[trace.length - 1] = { kind: 'result', isError: false, text: 'cancelled', costUsd: null }
  expect(service.enqueue('s')).toBeNull()
  trace[trace.length - 1] = { kind: 'result', isError: false, text: 'done', costUsd: null }
  workspace.setAppState('app-preferences', {
    intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'review', dailyReviews: 1 },
  })
  await service.tick(true)
  const pending = service.jobs().find((job) => job.status === 'pending')!
  service.dismiss(pending.id)
  trace.push(
    { kind: 'tool-use', toolUseId: 'test2', name: 'shell', summary: 'test' },
    { kind: 'result', isError: false, text: 'done', costUsd: null },
  )
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(1)
})

it('rejects stale skill revisions atomically and protects pinned procedures from generated rewrites', async () => {
  await service.tick(true)
  service.apply(service.jobs().find((job) => job.status === 'pending')!.id)
  const skill = service.skills()[0]!
  analyze.mockResolvedValue({
    provider: 'codex',
    model: 'test',
    message: JSON.stringify({
      ...proposal,
      skills: [{ ...proposal.skills[0], id: skill.id, expectedRevision: skill.revision }],
    }),
  })
  trace.push(
    { kind: 'tool-use', toolUseId: 'test2', name: 'shell', summary: 'test' },
    { kind: 'result', isError: false, text: 'done', costUsd: null },
  )
  await service.tick(true)
  const job = service.jobs().find((job) => job.status === 'pending')!
  service.control(skill.id, 'pin')
  expect(() => service.apply(job.id)).toThrow(/Skill changed|pinned/)
  expect(service.skills()[0]).toMatchObject({ content: skill.content, pinned: true })
})

it('rolls back all skill mutations if a later operation conflicts', async () => {
  analyze.mockResolvedValue({
    provider: 'codex',
    model: 'test',
    message: JSON.stringify({ ...proposal, memories: [], skills: [proposal.skills[0], proposal.skills[0]] }),
  })
  await service.tick(true)
  const job = service.jobs().find((job) => job.status === 'pending')!
  expect(() => service.apply(job.id)).toThrow(/Skill changed/)
  expect(service.skills()).toEqual([])
  expect(db.prepare('SELECT COUNT(*) AS count FROM skill_revisions').get()).toEqual({ count: 0 })
})

it('keeps an applied job committed if its Markdown export fails, preventing duplicate automatic writes', async () => {
  workspace.setAppState('app-preferences', { intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'auto' } })
  writeFileSync(join(root, 'skills'), 'Not a directory')
  await service.tick(true)
  expect(service.jobs()[0]).toMatchObject({ status: 'applied', error: expect.stringContaining('ENOTDIR') })
  expect(memory.active('p')).toHaveLength(1)
  expect(service.enqueue('s')).toBeNull()
  expect(() => service.apply(service.jobs()[0]!.id)).toThrow('No pending')
})

it('recalls original visible evidence by sequence without transferring provider reasoning', async () => {
  trace.splice(1, 0, { kind: 'thinking', text: 'Hidden provider reasoning' })
  const handlers = new Map<string, (args: unknown) => unknown>()
  service.register(
    {
      registerTool: (name: string, _config: unknown, handler: (args: unknown) => unknown) =>
        handlers.set(name, handler),
    } as never,
    's',
  )
  const result = await handlers.get('session_recall')!({ startSeq: 1, limit: 10 })
  expect(JSON.stringify(result)).toContain('Fix retries')
  expect(JSON.stringify(result)).toContain('Provider reasoning is not included')
  expect(JSON.stringify(result)).not.toContain('Hidden provider reasoning')
})

it('discovers cross-thread recall and skill selection through real deferred MCP with validated defaults', async () => {
  db.prepare('INSERT INTO agent_events VALUES (?, ?, ?)').run(
    'other',
    1,
    JSON.stringify({ kind: 'text', text: 'Authentication uses refresh rotation.' }),
  )
  service.write({
    id: 'browser',
    projectId: 'p',
    name: 'browser-tests',
    description: 'Test with a browser',
    content: 'Run browser checks.',
    activation: { requires_tools: ['browser_open'] },
    status: 'active',
    pinned: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    useCount: 0,
    sourceSessionId: 's',
    sourceSeq: 1,
  })
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const registry = new ToolRegistry(server, true)
  service.register(registry.server, 's')
  registry.expose()
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'tool_invoke', arguments: { name, arguments: args } })
    if (result.isError) throw new Error(JSON.stringify(result.content))
    return JSON.parse((result.content as { text: string }[])[0]!.text)
  }
  try {
    expect(registry.search('previous threads').map((entry) => entry.name)).toContain('session_search')
    const result = await call('session_search', { query: 'authentication' })
    expect(result.matches[0]).toMatchObject({ sessionId: 'other', seq: 1 })
    expect((await call('session_recall', { sessionId: 'other' })).events[0].event.text).toContain('refresh rotation')
    expect(await call('skill_resolve', { availableTools: [] })).toEqual([])
    expect((await call('skill_resolve', { id: 'browser', availableTools: ['browser_open'] })).content).toBe(
      'Run browser checks.',
    )
    const invalid = await client.callTool({
      name: 'tool_invoke',
      arguments: { name: 'session_recall', arguments: { startSeq: 0 } },
    })
    expect(invalid.isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
})

it('cancels skill learning without applying a late proposal or retrying the dismissed job', async () => {
  let release!: (value: Awaited<ReturnType<AgentService['analyze']>>) => void
  let signal!: AbortSignal
  analyze.mockImplementationOnce((_prompt, _settings, _length, options) => {
    signal = options!.signal!
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const running = service.tick(true)
  service.cancel()
  expect(signal.aborted).toBe(true)
  release({ provider: 'codex', model: 'test', message: JSON.stringify(proposal) })
  await running
  expect(service.snapshot().running).toBe(false)
  expect(service.jobs()[0]).toMatchObject({ status: 'dismissed', error: null })
  expect(service.skills()).toHaveLength(0)
  expect(service.checkpoint('s')).toBeNull()
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(1)
})

it('skips a repeated identical review without a model call, visibly, and retries on request', async () => {
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(1)
  const job = service.jobs()[0]!
  // The same job comes back (for example re-queued after a restart) with nothing changed.
  db.prepare('UPDATE learning_jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job, status: 'queued' }), job.id)
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(1)
  expect(service.jobs()[0]).toMatchObject({ status: 'dismissed', error: 'Skipped: nothing changed' })
  db.prepare('UPDATE learning_jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job, status: 'failed' }), job.id)
  service.retry(job.id)
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(2)
  // A changed memory is a changed input.
  memory.save({ projectId: 'p', kind: 'project', title: 'New fact', content: 'Something new' }, { actor: 'user' })
  db.prepare('UPDATE learning_jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job, status: 'queued' }), job.id)
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(3)
})
