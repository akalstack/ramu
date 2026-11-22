import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_INTELLIGENCE_PREFERENCES,
  type AgentEvent,
  type AgentSessionInfo,
  type UsageReading,
} from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { MemoryService } from '../src/memory/memory'
import type { AgentService } from '../src/agent'
import { crossedSwitchAt, LearningService } from '../src/memory/learning'
import { findSecret, redactSecrets } from '../src/memory/secrets'
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

it('coalesces unstarted turns into one review containing the earlier work', async () => {
  const first = service.enqueue('s')!
  trace.push(
    { kind: 'user', text: 'Also verify integration' },
    { kind: 'tool-use', toolUseId: 'integration', name: 'shell', summary: 'run integration tests' },
    { kind: 'result', isError: false, text: 'verified', costUsd: null },
  )
  const latest = service.enqueue('s')!
  expect(service.jobs()).toMatchObject([{ id: latest.id, seq: trace.length, status: 'queued' }])
  expect(service.jobs().some((job) => job.id === first.id)).toBe(false)
  expect(service.enqueue('s')).toBeNull()
  await service.tick(true)
  expect(analyze).toHaveBeenCalledTimes(1)
  expect(analyze.mock.calls[0]![0]).toContain('Fix retries')
  expect(analyze.mock.calls[0]![0]).toContain('Also verify integration')
})

it('cleans up a queued backlog after restart while preserving pending proposals', async () => {
  await service.tick(true)
  const pending = service.jobs()[0]!
  const insert = db.prepare('INSERT INTO learning_jobs VALUES (?, ?, ?, ?)')
  for (const seq of [10, 20, 30]) {
    const job = { ...pending, id: `queued-${seq}`, seq, status: 'queued', proposal: null }
    insert.run(job.id, job.sessionId, seq, JSON.stringify(job))
  }
  const restarted = new LearningService(
    db,
    workspace,
    { get: () => session, events: () => trace, analyze },
    memory,
    join(root, 'skills'),
    () => {},
  )
  expect(restarted.jobs().filter((job) => job.status === 'queued')).toMatchObject([{ seq: 30 }])
  expect(restarted.jobs().find((job) => job.id === pending.id)?.status).toBe('pending')
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
  db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)').run(
    'other',
    1,
    JSON.stringify({ kind: 'text', text: 'Authentication uses refresh rotation.' }),
  )
  service.write({
    id: 'browser',
    projectId: 'p',
    name: 'browser-tests',
    changedBy: 'learning',
    description: 'Test with a browser',
    content: 'Run browser checks.',
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
    expect((await call('session_search', { query: 'authentication '.repeat(100), limit: 100 })).matches).toHaveLength(1)
    expect((await call('session_recall', { sessionId: 'other' })).events[0].event.text).toContain('refresh rotation')
    expect((await call('session_recall', { sessionId: 'other', limit: 100 })).events).toHaveLength(1)
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

it('recognises known credential formats and long random tokens, and leaves ordinary text alone', () => {
  const secrets = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    `ghp_${'a1B2c3D4e5'.repeat(4)}`,
    `github_pat_${'A1b2C3d4E5f6G7h8I9j0K1l2M3'}`,
    'xoxb-1234567890-abcdefghij',
    'AKIAIOSFODNN7EXAMPLE',
    'ASIAIOSFODNN7EXAMPLE',
    `AIza${'Sy-abcdefghijklmnopqrstuvwxyz01234'.slice(0, 35)}`,
    'sk_live_51HabcdefghijklMNOPQRSTuv',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'postgres://admin:hunter2hunter2@db.internal:5432/app',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'GITHUB_TOKEN: ghs_not-matched-but-long-enough-value',
    'password = "correct-horse-battery"',
    // No vendor prefix: only the entropy and character mix give it away.
    'Run it with Zx9Qm2LpV7nR4tKc8YwB3hFj6DsA1eGu5Xo0',
  ]
  for (const text of secrets) expect(findSecret(text), text).not.toBeNull()
  const fine = [
    'Run pnpm --filter @ramu/server test after every change.',
    'Commit 4f2cc93b5a1d9e0c7a8b6d5e4f3a2b1c0d9e8f7a is the baseline.',
    'sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Session 3819a109-2f7e-4bc4-bc0c-569699bfb6bf was resumed.',
    'The task-based-implementation-of-retry-handling-is-documented here.',
    'Call useGoalVerificationRunnerForSessionsAndSchedules to run it.',
    'apps/server/src/agent/goalManager.ts and apps/server/src/background/schedules.ts changed.',
    'Set API_KEY=$API_KEY_FROM_ENV before running; token: <your-token-here>.',
    'postgres://user:${DB_PASSWORD}@localhost/app',
    'max_tokens = 100000000',
  ]
  for (const text of fine) expect(findSecret(text), text).toBeNull()
})

it('redacts credentials before text reaches a model and keeps the rest', () => {
  const text =
    'Use token=abcdef123456 and sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 with Zx9Qm2LpV7nR4tKc8YwB3hFj6DsA1eGu5Xo0 in /srv/app'
  const redacted = redactSecrets(text)
  expect(redacted).toBe('Use token=[redacted] and [redacted] with [redacted] in /srv/app')
  expect(redactSecrets('Commit 4f2cc93b5a1d9e0c7a8b6d5e4f3a2b1c0d9e8f7a')).toContain(
    '4f2cc93b5a1d9e0c7a8b6d5e4f3a2b1c0d9e8f7a',
  )
})

it('refuses an automatic proposal that carries a credential in any field and applies nothing', async () => {
  workspace.setAppState('app-preferences', { intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'auto' } })
  analyze.mockResolvedValue({
    provider: 'codex',
    model: 'test',
    message: JSON.stringify({
      ...proposal,
      skills: [
        {
          ...proposal.skills[0],
          content: 'Export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY first.',
        },
      ],
    }),
  })
  await service.tick(true)
  const job = service.jobs()[0]!
  // Auto-apply threw on the credential, so the job ends failed with the reason and nothing was written.
  expect(job).toMatchObject({ status: 'failed', error: expect.stringContaining('credential') })
  expect(service.skills()).toEqual([])
  expect(memory.active('p')).toEqual([])
})

it('refuses to apply a reviewed proposal that carries a credential', async () => {
  analyze.mockResolvedValue({
    provider: 'codex',
    model: 'test',
    message: JSON.stringify({
      ...proposal,
      memories: [{ ...proposal.memories[0], content: 'Deploy with ghp_' + 'a1B2c3D4e5'.repeat(4) }],
    }),
  })
  await service.tick(true)
  const job = service.jobs()[0]!
  expect(job.status).toBe('pending')
  expect(() => service.apply(job.id)).toThrow(/credential/)
  expect(memory.active('p')).toEqual([])
})

describe('refreshing the checkpoint when a provider crosses its early-switch threshold', () => {
  const CHECKPOINT = 'Retries fixed; run the integration suite next.'
  let near: boolean
  let refresh: LearningService
  const reply = (checkpoint: string) =>
    analyze.mockResolvedValue({ provider: 'codex', model: 'test', message: JSON.stringify({ checkpoint }) })
  /** The service under test: like the main one, but told whether the thread's provider is near its limit. */
  const make = () =>
    new LearningService(
      db,
      workspace,
      { get: () => session, events: () => trace, analyze },
      memory,
      join(root, 'skills2'),
      () => {},
      () => near,
    )
  const seed = () => {
    trace.forEach((event, i) =>
      db
        .prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)')
        .run('s', i + 1, JSON.stringify(event)),
    )
  }
  beforeEach(() => {
    near = true
    refresh = make()
    seed()
    reply(CHECKPOINT)
  })
  afterEach(async () => {
    await refresh.settle()
  })

  it('writes the checkpoint at once, without the settle wait or a review, and proposes nothing', async () => {
    await refresh.tick()
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0]![0]).toContain('ramu-checkpoint')
    expect(analyze.mock.calls[0]![0]).not.toContain('"skills"')
    // Review-first mode still gets the checkpoint: it is thread-local, so no memory or skill is written by it.
    expect(refresh.checkpoint('s')).toMatchObject({ seq: 5, summary: CHECKPOINT })
    expect(memory.active('p')).toEqual([])
    expect(refresh.skills()).toEqual([])
    // The regular review of the turn is still queued behind its settle wait and untouched.
    expect(refresh.jobs().map((job) => job.status)).toEqual(['queued'])
  })

  it('does nothing while the provider is below the threshold', async () => {
    near = false
    await refresh.tick()
    expect(analyze).not.toHaveBeenCalled()
    expect(refresh.checkpoint('s')).toBeNull()
  })

  it('does nothing without a usage hook, and while learning is off', async () => {
    const bare = new LearningService(
      db,
      workspace,
      { get: () => session, events: () => trace, analyze },
      memory,
      join(root, 'skills3'),
      () => {},
    )
    await bare.tick()
    workspace.setAppState('app-preferences', { intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'off' } })
    await refresh.tick()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('skips a thread that will not be switched, and one whose checkpoint is already current', async () => {
    const stays = { ...session, settings: { ...DEFAULT_AGENT_SETTINGS, autoFallback: false } } as AgentSessionInfo
    const waits = new LearningService(
      db,
      workspace,
      { get: () => stays, events: () => trace, analyze },
      memory,
      join(root, 'skills4'),
      () => {},
      () => true,
    )
    await waits.tick()
    expect(analyze).not.toHaveBeenCalled()
    db.prepare('INSERT INTO session_checkpoints VALUES (?, ?)').run(
      's',
      JSON.stringify({ sessionId: 's', seq: 5, summary: 'Current', updatedAt: 1 }),
    )
    await refresh.tick()
    expect(analyze).not.toHaveBeenCalled()
    expect(refresh.checkpoint('s')?.summary).toBe('Current')
  })

  it('stays off the foreground and inside the daily review budget', async () => {
    db.exec(
      "INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES ('busy','t','codex','/tmp','running',2)",
    )
    await refresh.tick()
    expect(analyze).not.toHaveBeenCalled()
    db.exec("UPDATE agent_sessions SET state='idle' WHERE id='busy'")
    const { dailyReviews } = DEFAULT_INTELLIGENCE_PREFERENCES
    workspace.setAppState(
      'learning-review-times',
      Array.from({ length: dailyReviews }, () => Date.now()),
    )
    await refresh.tick()
    expect(analyze).not.toHaveBeenCalled()
    workspace.setAppState('learning-review-times', [])
    await refresh.tick()
    expect(analyze).toHaveBeenCalledTimes(1)
    // It spent one review of the day, like any other.
    expect(workspace.getAppState<number[]>('learning-review-times', [])).toHaveLength(1)
  })

  it('refreshes a turn once, across ticks and across a restart, even when the model call failed', async () => {
    await refresh.tick()
    await refresh.tick()
    expect(analyze).toHaveBeenCalledTimes(1)
    const restarted = make()
    db.prepare('DELETE FROM session_checkpoints').run()
    await restarted.tick()
    expect(analyze).toHaveBeenCalledTimes(1)
    await restarted.settle()
  })

  it('leaves the older checkpoint alone when the call fails, a secret comes back, or the answer is empty', async () => {
    db.prepare('INSERT INTO session_checkpoints VALUES (?, ?)').run(
      's',
      JSON.stringify({ sessionId: 's', seq: 2, summary: 'Older', updatedAt: 1 }),
    )
    analyze.mockRejectedValueOnce(new Error('usage limit'))
    await refresh.tick()
    expect(refresh.checkpoint('s')?.summary).toBe('Older')
    // A new turn is a new chance; a credential in the answer is dropped, not stored.
    trace.push(
      { kind: 'user', text: 'Now the suite' },
      { kind: 'tool-use', toolUseId: 'suite', name: 'shell', summary: 'run suite' },
      { kind: 'result', isError: false, text: 'done', costUsd: null },
    )
    db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)').run(
      's',
      6,
      JSON.stringify(trace[5]),
    )
    db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)').run(
      's',
      7,
      JSON.stringify(trace[6]),
    )
    db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)').run(
      's',
      8,
      JSON.stringify(trace[7]),
    )
    reply('Set AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY first')
    await refresh.tick()
    expect(refresh.checkpoint('s')?.summary).toBe('Older')
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('runs the queued review itself in Automatic mode instead of making a second call for the same turn', async () => {
    workspace.setAppState('app-preferences', {
      intelligence: { ...DEFAULT_INTELLIGENCE_PREFERENCES, learning: 'auto' },
    })
    analyze.mockResolvedValue({ provider: 'codex', model: 'test', message: JSON.stringify(proposal) })
    await refresh.tick()
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0]![0]).toContain('ramu-learning')
    expect(refresh.jobs()[0]).toMatchObject({ status: 'applied' })
    expect(refresh.checkpoint('s')?.summary).toBe(proposal.checkpoint)
  })

  it('never blocks or changes the deterministic path: an unreadable checkpoint is simply absent', async () => {
    analyze.mockRejectedValue(new Error('offline'))
    await refresh.tick()
    expect(refresh.checkpoint('s')).toBeNull()
    expect(refresh.instructions('s')).not.toContain('checkpoint')
  })
})

it('crosses the early-switch threshold only below the limit, with a threshold set', () => {
  const reading = (usedPercent: number, status: UsageReading['status'] = 'ok'): UsageReading =>
    ({ provider: 'codex', window: 'weekly', usedPercent, status, updatedAt: Date.now() }) as UsageReading
  const settings = { provider: 'codex', model: 'any' } as const
  expect(crossedSwitchAt([reading(85)], settings, 80)).toBe(true)
  expect(crossedSwitchAt([reading(70)], settings, 80)).toBe(false)
  // "Only at the limit" never refreshes early, and a provider already limited is held or switched, not refreshed.
  expect(crossedSwitchAt([reading(99)], settings, null)).toBe(false)
  expect(crossedSwitchAt([reading(100, 'limited')], settings, 80)).toBe(false)
  expect(crossedSwitchAt([], settings, 80)).toBe(false)
  expect(crossedSwitchAt([{ ...reading(95), provider: 'claude-code' }], settings, 80)).toBe(false)
})
