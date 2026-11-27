import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type AgentScope } from '@ramu/shared/types'
import { CursorSession, cursorModel, cursorModels, cursorTurnTokens } from '../src/providers/cursor'
import {
  formAnswer,
  formQuestions,
  openCodeModel,
  openCodePermissions,
  openCodeServerEnv,
  OpenCodeSession,
} from '../src/providers/opencode'
import { ResumeUnavailable } from '../src/agent/agentRunner'

const scope = { cwd: '/work', additionalDirs: [], covers: ['/work'] } as unknown as AgentScope

/** A stand-in for `@cursor/sdk`: each send replays `messages` and records what the runner passed. */
function fakeCursor(messages: unknown[], result: Record<string, unknown> = { status: 'finished' }) {
  const calls: { create?: any; resume?: string; resumeOptions?: any; sends: { text: string; options: any }[] } = {
    sends: [],
  }
  const agent = {
    agentId: 'agent-1',
    send: async (text: string, options: any) => {
      calls.sends.push({ text, options })
      return {
        id: 'run-1',
        supports: () => true,
        async *stream() {
          for (const m of messages) yield m
        },
        wait: async () => ({ id: 'run-1', ...result }),
        cancel: async () => {},
      }
    },
    close: () => {},
  }
  const sdk = {
    Agent: {
      create: async (options: any) => ((calls.create = options), agent),
      resume: async (id: string, options: any) => {
        calls.resume = id
        calls.resumeOptions = options
        if (id === 'agent-resume') return agent
        if (id === 'agent-offline') throw Object.assign(new Error('fetch failed'), { name: 'NetworkError' })
        throw Object.assign(new Error('not found'), { name: 'AgentNotFoundError', code: 'agent_not_found' })
      },
    },
    Cursor: {},
  }
  return { sdk: sdk as any, calls }
}

const settle = async (events: AgentEvent[], kind: AgentEvent['kind'] = 'result') => {
  for (let i = 0; i < 100 && !events.some((e) => e.kind === kind); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('Cursor SDK runner', () => {
  it('streams text, tools and the result, with Ramu tools and the sandbox', async () => {
    const { sdk, calls } = fakeCursor([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Look' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ing' }] } },
      { type: 'tool_call', call_id: 'c1', name: 'shell', status: 'running', args: { command: 'ls' } },
      { type: 'tool_call', call_id: 'c1', name: 'shell', status: 'completed', result: 'a.txt' },
      {
        type: 'tool_call',
        call_id: 'mcp1',
        name: 'mcp',
        status: 'running',
        args: { server: 'ramu', tool: 'tool_invoke' },
      },
      { type: 'tool_call', call_id: 'mcp1', name: 'mcp', status: 'completed', result: 'done' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ])
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', access: 'auto' },
      (e) => events.push(e),
      false,
      sdk,
    )
    runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 't', nativeSubagents: false })
    await runner.start('hi', null)
    await settle(events)
    expect(calls.create.local).toMatchObject({ cwd: '/work', sandboxOptions: { enabled: true }, autoReview: true })
    expect(calls.create.model).toEqual(cursorModel(''))
    expect(calls.create.disallowedTools).toEqual(['task'])
    expect(calls.sends[0]!.options.mcpServers.ramu).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer t' },
    })
    const texts = events.filter((e) => e.kind === 'text') as Extract<AgentEvent, { kind: 'text' }>[]
    expect(texts.map((e) => e.text)).toEqual(['Look', 'Looking', 'Done'])
    expect(new Set(texts.map((e) => e.messageId)).size).toBe(2)
    expect(events.find((e) => e.kind === 'tool-use')).toMatchObject({ toolKind: 'execute', summary: 'ls' })
    expect(events.find((e) => e.kind === 'tool-result')).toMatchObject({ isError: false, summary: 'a.txt' })
    expect(events.find((e) => e.kind === 'result')).toMatchObject({ isError: false, text: 'end_turn' })
    expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
  })

  it('records the turn tokens from Cursor usage, from its message or else the run result', async () => {
    const usage = {
      inputTokens: 1200,
      outputTokens: 80,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      totalTokens: 1580,
      reasoningTokens: 20,
    }
    for (const [messages, result] of [
      [
        [
          { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
          { type: 'usage', agent_id: 'agent-1', run_id: 'run-1', usage },
        ],
        { status: 'finished' },
      ],
      [[{ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }], { status: 'finished', usage }],
    ] as const) {
      const { sdk } = fakeCursor([...messages], { ...result })
      const events: AgentEvent[] = []
      const runner = new CursorSession(
        scope,
        { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', access: 'auto' },
        (e) => events.push(e),
        false,
        sdk,
      )
      await runner.start('hi', null)
      await settle(events)
      // Cached reads count as input and reasoning as output, as for Claude and Codex.
      expect(events.find((e) => e.kind === 'result')).toMatchObject({ tokens: { input: 1500, output: 100 } })
    }
    expect(cursorTurnTokens({ inputTokens: 'x', outputTokens: 1 })).toBeNull()
  })

  it('enables native Auto-review for Auto on both create and resume', async () => {
    for (const resume of [null, 'agent-resume']) {
      const { sdk, calls } = fakeCursor([])
      const events: AgentEvent[] = []
      const runner = new CursorSession(
        scope,
        { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', access: 'auto' },
        (event) => events.push(event),
        false,
        sdk,
      )
      await runner.start('git diff', resume)
      await settle(events)
      expect((resume ? calls.resumeOptions : calls.create).local).toMatchObject({
        autoReview: true,
        sandboxOptions: { enabled: true },
      })
      await runner.stop()
    }
  })

  it('runs unsandboxed with full access, and reports limits as usage', async () => {
    const { sdk, calls } = fakeCursor([], { status: 'error', error: { message: 'You hit your usage limit' } })
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', access: 'full', model: 'composer-2.5' },
      (e) => events.push(e),
      false,
      sdk,
    )
    await runner.start('hi', null)
    await settle(events)
    expect(calls.create.local.sandboxOptions).toBeUndefined()
    expect(calls.create.model).toEqual({ id: 'composer-2.5' })
    expect(events.some((e) => e.kind === 'usage')).toBe(true)
    expect(events.find((e) => e.kind === 'result')).toMatchObject({ isError: true })
  })

  it('offers each Cursor model its effort levels and Fast, and sends them only where offered', async () => {
    const sdk = {
      Cursor: {
        models: {
          list: async () => [
            {
              id: 'gpt-6.1',
              displayName: 'GPT-6.1',
              parameters: [
                {
                  id: 'reasoning',
                  values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'turbo' }],
                },
                { id: 'fast', values: [{ value: 'true' }, { value: 'false' }] },
              ],
              variants: [{ displayName: 'Default', isDefault: true, params: [{ id: 'reasoning', value: 'medium' }] }],
            },
            { id: 'composer-2.5', displayName: 'Composer 2.5' },
          ],
        },
      },
    } as any
    const [gpt, composer] = await cursorModels(undefined, sdk)
    expect(gpt).toMatchObject({
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      serviceTiers: ['standard', 'fast'],
    })
    expect(composer).toMatchObject({ efforts: [], defaultEffort: null })
    expect(composer!.serviceTiers).toBeUndefined()
    expect(cursorModel('gpt-6.1', 'high', true)).toEqual({
      id: 'gpt-6.1',
      params: [
        { id: 'reasoning', value: 'high' },
        { id: 'fast', value: 'true' },
      ],
    })
    expect(cursorModel('composer-2.5', 'high', true)).toEqual({ id: 'composer-2.5' })
  })

  it('shows Cursor todo lists, plans and sub-agents as their own cards, not tool rows', async () => {
    const base = { type: 'tool_call', agent_id: 'agent-1', run_id: 'run-1' }
    const { sdk } = fakeCursor([
      {
        ...base,
        call_id: 't1',
        name: 'updateTodos',
        status: 'completed',
        args: {
          todos: [
            { content: 'Read the code', status: 'completed' },
            { content: 'Fix the bug', status: 'inProgress' },
            { content: 'Old idea', status: 'cancelled' },
          ],
        },
      },
      { ...base, call_id: 'p1', name: 'createPlan', status: 'completed', args: { plan: '# Plan\n1. Fix it' } },
      {
        ...base,
        call_id: 'h1',
        name: 'task',
        status: 'completed',
        args: { description: 'Explore auth', prompt: 'Find the login code', subagentType: { kind: 'explore' } },
        result: {
          status: 'success',
          value: { conversationSteps: [{ assistantMessage: { text: 'It is in auth.ts.' } }] },
        },
      },
    ])
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' },
      (e) => events.push(e),
      false,
      sdk,
    )
    await runner.start('hi', null)
    await settle(events)
    expect(events.find((e) => e.kind === 'plan')).toMatchObject({
      entries: [
        { content: 'Read the code', status: 'completed' },
        { content: 'Fix the bug', status: 'in_progress' },
      ],
    })
    expect(events.find((e) => e.kind === 'text' && e.text.startsWith('# Plan'))).toBeTruthy()
    expect(events.find((e) => e.kind === 'agent')).toMatchObject({
      agentId: 'h1',
      name: 'Explore auth',
      agentType: 'explore',
      status: 'completed',
      summary: 'It is in auth.ts.',
    })
    expect(events.some((e) => e.kind === 'tool-use' || e.kind === 'tool-result')).toBe(false)
  })

  it('turns a lost agent into ResumeUnavailable, and keeps the agent through any other resume failure', async () => {
    const { sdk } = fakeCursor([])
    const runner = new CursorSession(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' }, () => {}, false, sdk)
    await expect(runner.start('hi', 'agent-old')).rejects.toBeInstanceOf(ResumeUnavailable)
    // Offline or signed out: the thread's Cursor history must not be dropped for a new agent.
    const offline = runner.start('hi', 'agent-offline')
    await expect(offline).rejects.toThrow('fetch failed')
    await expect(offline).rejects.not.toBeInstanceOf(ResumeUnavailable)
  })

  it('sends attached images to the model as images', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-cursor-'))
    try {
      const path = join(dir, 'shot.png')
      writeFileSync(path, Buffer.from([1, 2, 3]))
      const { sdk, calls } = fakeCursor([])
      const events: AgentEvent[] = []
      const runner = new CursorSession(
        scope,
        { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' },
        (e) => events.push(e),
        false,
        sdk,
      )
      await runner.start('What is wrong here?', null, [
        { id: 'a', name: 'shot.png', mimeType: 'image/png', size: 3, path } as any,
      ])
      await settle(events)
      expect(calls.sends[0]!.text).toEqual({
        text: 'What is wrong here?',
        images: [{ data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' }],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a usage limit from its code even when the message does not say so', async () => {
    const { sdk } = fakeCursor([], {
      status: 'error',
      error: { message: 'Request failed', code: 'PRO_USER_USAGE_LIMIT' },
    })
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' },
      (e) => events.push(e),
      false,
      sdk,
    )
    await runner.start('hi', null)
    await settle(events)
    expect(events.some((e) => e.kind === 'usage')).toBe(true)
  })

  it('ends a run left by an earlier process, then starts the turn', async () => {
    const { sdk, calls } = fakeCursor([])
    const agent = await sdk.Agent.create({})
    const send = agent.send
    let busy = true
    agent.send = async (text: string, options: any) => {
      if (busy) {
        busy = false
        throw Object.assign(new Error('Agent already has active run'), { name: 'AgentBusyError' })
      }
      return send(text, options)
    }
    const cancelled: string[] = []
    sdk.Agent.create = async () => agent
    sdk.Agent.listRuns = async () => ({ items: [{ id: 'run-old', status: 'running' }] })
    sdk.Agent.cancelRun = async (id: string) => void cancelled.push(id)
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' },
      (e) => events.push(e),
      false,
      sdk,
    )
    await runner.start('hi', null)
    await settle(events)
    expect(cancelled).toEqual(['run-old'])
    expect(calls.sends).toHaveLength(1)
    expect(events.find((e) => e.kind === 'result')).toMatchObject({ isError: false })
  })
})

describe('OpenCode 2 helpers', () => {
  it('adds Ramu tools under mcp.servers without dropping the user config', () => {
    const env = openCodeServerEnv(
      { url: 'http://127.0.0.1:1/mcp', token: 't', nativeSubagents: false },
      JSON.stringify({ mcp: { servers: { mine: { type: 'remote', url: 'x' } } } }),
    )
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    expect(Object.keys(config.mcp.servers)).toEqual(['mine', 'ramu', 'ramu_tools'])
    expect(config.mcp.servers.ramu.headers).toEqual({ Authorization: 'Bearer t' })
    // OpenCode 2 ignores the v1 `permission` key; the switch is a session permission.
    expect(config.permission).toBeUndefined()
    expect(openCodePermissions({ url: '', token: '', nativeSubagents: false })).toEqual([
      { action: 'task', resource: '*', effect: 'deny' },
    ])
    expect(openCodeServerEnv(undefined, undefined)).toEqual({})
  })

  it('maps Full access to OpenCode allow-all with commands still asking, and leaves Auto to approving what OpenCode asks', () => {
    expect(openCodePermissions(undefined, 'full')).toEqual([
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'bash', resource: '*', effect: 'ask' },
    ])
    expect(openCodePermissions(undefined, 'auto')).toEqual([])
    // The sub-agent switch comes last, so it still wins over allow-all.
    expect(openCodePermissions({ url: '', token: '', nativeSubagents: false }, 'full')).toEqual([
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'bash', resource: '*', effect: 'ask' },
      { action: 'task', resource: '*', effect: 'deny' },
    ])
  })

  it('splits provider/model and passes effort as the variant', () => {
    expect(openCodeModel('openrouter/meta/llama', 'high')).toEqual({
      providerID: 'openrouter',
      id: 'meta/llama',
      variant: 'high',
    })
    expect(openCodeModel('')).toBeUndefined()
  })

  it('maps forms to questions and answers back to typed values', () => {
    const form = {
      id: 'f1',
      title: 'Setup',
      fields: [
        { key: 'db', type: 'string', title: 'Database', options: [{ value: 'pg', label: 'Postgres' }] },
        { key: 'tests', type: 'boolean', title: 'Add tests?' },
        { key: 'tags', type: 'multiselect', title: 'Tags', options: [{ value: 'a' }, { value: 'b' }] },
        { key: 'secret', type: 'string', hidden: true },
      ],
    }
    const questions = formQuestions(form)
    expect(questions.map((q) => q.id)).toEqual(['db', 'tests', 'tags'])
    expect(questions[2]!.multiSelect).toBe(true)
    expect(formAnswer(form, { db: 'Postgres', tests: 'Yes', tags: 'a, b' })).toEqual({
      db: 'pg',
      tests: true,
      tags: ['a', 'b'],
    })
  })
})

/** Native OpenCode policy decides when to emit a permission request; replay only those requests. */
function fakeOpenCode(action: string, resources = ['*']) {
  const replies: Record<string, unknown>[] = []
  const configurations: { method: string; input: any }[] = []
  const queue: Record<string, unknown>[] = []
  let wake: (() => void) | undefined
  const push = (event: Record<string, unknown>) => {
    queue.push(event)
    wake?.()
  }
  const client = {
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        yield { type: 'server.connected' }
        while (!signal.aborted) {
          if (!queue.length)
            await new Promise<void>((resolve) => {
              wake = resolve
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
          if (signal.aborted) return
          const event = queue.shift()
          if (event) yield event
        }
      },
    },
    session: {
      create: async (input: any) => {
        configurations.push({ method: 'create', input })
        return { id: 'session-1' }
      },
      get: async () => ({ id: 'session-1' }),
      update: async (input: any) => {
        configurations.push({ method: 'update', input })
      },
      prompt: async () =>
        push({ type: 'permission.asked', data: { id: 'p1', sessionID: 'session-1', action, resources } }),
    },
    permission: {
      reply: async (reply: Record<string, unknown>) => {
        replies.push(reply)
        push({ type: 'session.execution.succeeded', data: { sessionID: 'session-1' } })
      },
    },
  }
  return { client, replies, configurations }
}

describe('OpenCode Full access', () => {
  it.each([
    ['pnpm test', false],
    ['vercel deploy --prod', true],
  ] as const)('answers commands itself and asks only before a production deploy: %s', async (command, asks) => {
    const { client, replies } = fakeOpenCode('bash', [command])
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'full' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    try {
      await runner.start('Run it', null)
      if (asks) {
        await settle(events, 'permission-request')
        expect(events.find((event) => event.kind === 'permission-request')).toMatchObject({
          approvalOnceOnly: true,
          approvalFullAccess: { reason: 'Deploys to production' },
        })
        expect(replies).toEqual([])
        runner.replyPermission('p1', false)
      } else await settle(events)
      await vi.waitFor(() =>
        expect(replies).toEqual([{ sessionID: 'session-1', requestID: 'p1', decision: asks ? 'reject' : 'once' }]),
      )
    } finally {
      await runner.stop()
    }
  })
})

describe('OpenCode Auto', () => {
  it.each([
    ['vercel deploy', false],
    ['npx vercel deploy --prod', true],
  ] as const)('answers commands itself and asks before a production deploy: %s', async (command, asks) => {
    const { client, replies } = fakeOpenCode('bash', [command])
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'auto' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    try {
      await runner.start('Ship it', null)
      if (asks) {
        await settle(events, 'permission-request')
        expect(events.find((event) => event.kind === 'permission-request')).toMatchObject({
          approvalOnceOnly: true,
          approvalCommand: command,
          detail: expect.stringContaining('Deploys to production'),
        })
        expect(replies).toEqual([])
        runner.replyPermission('p1', false)
      } else await settle(events)
      await vi.waitFor(() =>
        expect(replies).toEqual([{ sessionID: 'session-1', requestID: 'p1', decision: asks ? 'reject' : 'once' }]),
      )
    } finally {
      await runner.stop()
    }
  })
})

describe('OpenCode Allow edits', () => {
  it.each([
    ['ramu_ask_user', false],
    ['ramu_browser_click', false],
    ['ramu_tools_settings_change', false],
    ['ramu_tools_schedule_create', true],
    ['shared_mcp_Linear-abc123__list_issues', false],
    ['ramu_schedule_create', true],
    ['ramu_other_tool', true],
    ['github_create_issue', true],
  ] as const)('answers MCP calls Ramu decides itself and asks for the rest: %s', async (action, asks) => {
    const { client, replies } = fakeOpenCode(action, ['*'])
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'edits' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 'test' })
    try {
      await runner.start('Do it', null)
      if (asks) {
        await settle(events, 'permission-request')
        expect(replies).toEqual([])
        runner.replyPermission('p1', false)
      } else await settle(events)
      await vi.waitFor(() =>
        expect(replies).toEqual([{ sessionID: 'session-1', requestID: 'p1', decision: asks ? 'reject' : 'once' }]),
      )
    } finally {
      await runner.stop()
    }
  })
})

describe('OpenCode tool results', () => {
  it('marks a command that exits non-zero as failed, and shows images a tool returned', async () => {
    const { client } = fakeOpenCode('bash')
    const push = (client as any).event.subscribe
    const queued: Record<string, unknown>[] = [
      { type: 'session.tool.input.started', data: { sessionID: 'session-1', id: 'c1', name: 'bash' } },
      {
        type: 'session.tool.success',
        data: {
          sessionID: 'session-1',
          id: 'c1',
          content: [{ type: 'text', text: '1 failed\n' }],
          metadata: { exit: 1 },
        },
      },
      { type: 'session.tool.input.started', data: { sessionID: 'session-1', id: 's1', name: 'screenshot' } },
      {
        type: 'session.tool.success',
        data: {
          sessionID: 'session-1',
          id: 's1',
          content: [
            { type: 'file', mime: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' },
            { type: 'file', mime: 'image/png', url: 'file:///tmp/secret.png' },
          ],
        },
      },
      { type: 'session.execution.succeeded', data: { sessionID: 'session-1' } },
    ]
    ;(client as any).event.subscribe = async function* (options: { signal: AbortSignal }) {
      const inner = push(options)
      yield (await inner.next()).value
      while (!(await promptSent)) yield* []
      for (const event of queued) yield event
      yield* inner
    }
    let sent!: (value: boolean) => void
    const promptSent = new Promise<boolean>((resolve) => (sent = resolve))
    ;(client as any).session.prompt = async () => sent(true)
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    try {
      await runner.start('Run the tests', null)
      await settle(events)
      const results = events.filter((event) => event.kind === 'tool-result')
      expect(results[0]).toMatchObject({ toolUseId: 'c1', isError: true, status: 'failed' })
      expect(results[1]).toMatchObject({
        toolUseId: 's1',
        isError: false,
        content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
      })
    } finally {
      await runner.stop()
    }
  })
})

it("passes on the title OpenCode gives its own session, not a sub-agent's", async () => {
  const { client } = fakeOpenCode('bash')
  const push = (client as any).event.subscribe
  ;(client as any).event.subscribe = async function* (options: { signal: AbortSignal }) {
    const inner = push(options)
    yield (await inner.next()).value
    await promptSent
    yield { type: 'session.renamed', data: { sessionID: 'child-1', title: 'Sub-agent work' } }
    yield { type: 'session.renamed', data: { sessionID: 'session-1', title: 'Single word ok' } }
    yield { type: 'session.execution.succeeded', data: { sessionID: 'session-1' } }
    yield* inner
  }
  let sent!: () => void
  const promptSent = new Promise<void>((resolve) => (sent = resolve))
  ;(client as any).session.prompt = async () => sent()
  const events: AgentEvent[] = []
  const runner = new OpenCodeSession(
    scope,
    { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode' },
    (event) => events.push(event),
    false,
    async () => client as never,
  )
  try {
    await runner.start('Reply with ok', null)
    await settle(events)
    expect(events.filter((event) => event.kind === 'title')).toEqual([{ kind: 'title', title: 'Single word ok' }])
  } finally {
    await runner.stop()
  }
})

describe('OpenCode Auto permissions', () => {
  it.each([
    ['bash', null],
    ['bash', 'session-1'],
    ['ramu_tool_invoke', null],
    ['ramu_tool_invoke', 'session-1'],
  ] as const)('auto-approves %s asks in session %s', async (action, resume) => {
    const { client, replies } = fakeOpenCode(action)
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'auto' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 'test' })
    try {
      await runner.start('Use a Ramu tool', resume)
      await settle(events)
      expect(replies).toEqual([{ sessionID: 'session-1', requestID: 'p1', decision: 'once' }])
      expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
      expect(events.some((event) => event.kind === 'result')).toBe(true)
    } finally {
      await runner.stop()
    }
  })

  it.each(['bash', 'external_tool_invoke', 'mcp__external__ramu_tool_invoke', 'ramu_other_tool'])(
    'keeps manual approval requests for %s interactive',
    async (action) => {
      const { client, replies } = fakeOpenCode(action)
      const events: AgentEvent[] = []
      const runner = new OpenCodeSession(
        scope,
        { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'edits' },
        (event) => events.push(event),
        false,
        async () => client as never,
      )
      runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 'test' })
      try {
        await runner.start('Do work', null)
        expect(events).toContainEqual(expect.objectContaining({ kind: 'permission-request', toolName: action }))
        expect(replies).toEqual([])
        runner.replyPermission('p1', false)
        await settle(events)
        expect(replies[0]).toMatchObject({ decision: 'reject' })
      } finally {
        await runner.stop()
      }
    },
  )

  it('keeps read-only analysis restricted even for a Ramu tool', async () => {
    const { client, replies } = fakeOpenCode('ramu_tool_invoke')
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'auto' },
      (event) => events.push(event),
      true,
      async () => client as never,
    )
    runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 'test' })
    try {
      await runner.start('Read only', null)
      await settle(events)
      expect(replies[0]).toMatchObject({ decision: 'reject' })
      expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
    } finally {
      await runner.stop()
    }
  })
})

describe('Allow edits native policies', () => {
  it.each([null, 'session-1'])('configures OpenCode edits and command approvals on start/resume %s', async (resume) => {
    const { client, replies, configurations } = fakeOpenCode('bash')
    const events: AgentEvent[] = []
    const runner = new OpenCodeSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode', access: 'edits' },
      (event) => events.push(event),
      false,
      async () => client as never,
    )
    runner.setTools({ url: 'http://localhost/mcp', token: 't', nativeSubagents: false })
    try {
      await runner.start('Edit the file', resume)
      const config = configurations.find((call) => call.method === (resume ? 'update' : 'create'))!
      const effect = (action: string, resource = '*') =>
        config.input.permissions.findLast(
          (rule: any) =>
            (rule.action === '*' || rule.action === action) && (rule.resource === '*' || rule.resource === resource),
        )?.effect
      expect(effect('edit')).toBe('allow')
      expect(effect('bash')).toBe('ask')
      expect(effect('webfetch')).toBe('ask')
      expect(effect('read')).toBe('allow')
      expect(effect('read', '*.env')).toBe('ask')
      expect(effect('read', '*.env.example')).toBe('allow')
      expect(effect('task')).toBe('deny')
      expect(replies).toEqual([])
      expect(events).toContainEqual(expect.objectContaining({ kind: 'permission-request', toolName: 'bash' }))
      runner.replyPermission('p1', false)
      await settle(events)
    } finally {
      await runner.stop()
    }
  })

  it.each([null, 'agent-resume'])(
    'keeps Cursor edits sandboxed without Auto-review on start/resume %s',
    async (resume) => {
      const { sdk, calls } = fakeCursor([])
      const events: AgentEvent[] = []
      const runner = new CursorSession(
        scope,
        { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', access: 'edits' },
        (event) => events.push(event),
        false,
        sdk,
      )
      try {
        await runner.start('Edit the file', resume)
        await settle(events)
        expect((resume ? calls.resumeOptions : calls.create).local).toMatchObject({
          autoReview: false,
          sandboxOptions: { enabled: true },
        })
      } finally {
        await runner.stop()
      }
    },
  )
})

it('reads OpenCode live MCP state and reconnects through its native client', async () => {
  const { client } = fakeOpenCode('bash')
  const connections: unknown[] = []
  const withMcp = {
    ...client,
    mcp: {
      list: async () => ({
        data: [
          { name: 'atlassian', status: { status: 'needs_auth', error: 'Sign in first' } },
          { name: 'docs', status: { status: 'connected' } },
        ],
      }),
      connect: async (input: unknown) => {
        connections.push(input)
      },
    },
  }
  const runner = new OpenCodeSession(
    scope,
    { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode' },
    () => {},
    false,
    async () => withMcp as never,
  )
  try {
    await runner.start('hello', null)
    expect(await runner.mcpStatus()).toMatchObject({
      live: true,
      canReconnect: true,
      servers: [
        { name: 'atlassian', status: 'needs-auth', error: 'Sign in first' },
        { name: 'docs', status: 'connected' },
      ],
    })
    await runner.reconnectMcp('atlassian')
    expect(connections).toEqual([{ server: 'atlassian', location: { directory: scope.cwd } }])
  } finally {
    await runner.stop()
  }
})

it('shows Cursor workspace configuration without claiming a verified connection', async () => {
  const { sdk } = fakeCursor([])
  const runner = new CursorSession(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' }, () => {}, false, sdk)
  runner.setTools({ url: 'http://localhost/mcp', token: 'secret' })
  expect(await runner.mcpStatus()).toMatchObject({
    live: false,
    source: 'configuration',
    servers: [{ name: 'ramu', status: 'configured' }],
  })
})

describe('OpenCode server lifecycle', () => {
  it('does not leave a server running when the chat is stopped while it was still starting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-opencode-'))
    const bin = join(dir, 'opencode')
    writeFileSync(
      bin,
      `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.RAMU_PID_FILE, String(process.pid));
setTimeout(() => console.log('opencode server listening on http://127.0.0.1:1'), 300);
setInterval(() => {}, 1000);
`,
    )
    chmodSync(bin, 0o755)
    vi.stubEnv('RAMU_OPENCODE_BIN', bin)
    vi.stubEnv('RAMU_PID_FILE', join(dir, 'pid'))
    const runner = new OpenCodeSession(
      { ...scope, cwd: dir },
      { ...DEFAULT_AGENT_SETTINGS, provider: 'opencode' },
      () => {},
    )
    const started = runner.start('hello', null).catch(() => {})
    try {
      await vi.waitFor(() => expect(readFileSync(join(dir, 'pid'), 'utf8')).not.toBe(''))
      const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'))
      await runner.stop()
      await started
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5000 })
    } finally {
      await runner.stop()
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
