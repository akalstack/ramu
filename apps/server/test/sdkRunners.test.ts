import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type AgentScope } from '@ramu/shared/types'
import { CursorSession, cursorModel } from '../src/providers/cursor'
import {
  formAnswer,
  formQuestions,
  openCodeModel,
  openCodePermissions,
  openCodeServerEnv,
} from '../src/providers/opencode'
import { ResumeUnavailable } from '../src/agent/agentRunner'

const scope = { cwd: '/work', additionalDirs: [], covers: ['/work'] } as unknown as AgentScope

/** A stand-in for `@cursor/sdk`: each send replays `messages` and records what the runner passed. */
function fakeCursor(messages: unknown[], result: Record<string, unknown> = { status: 'finished' }) {
  const calls: { create?: any; resume?: string; sends: { text: string; options: any }[] } = { sends: [] }
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
      resume: async (id: string) => {
        calls.resume = id
        throw new Error('not found')
      },
    },
    Cursor: {},
  }
  return { sdk: sdk as any, calls }
}

const settle = async (events: AgentEvent[]) => {
  for (let i = 0; i < 100 && !events.some((e) => e.kind === 'result'); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('Cursor SDK runner', () => {
  it('streams text, tools and the result, with Ramu tools and the sandbox', async () => {
    const { sdk, calls } = fakeCursor([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Look' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ing' }] } },
      { type: 'tool_call', call_id: 'c1', name: 'shell', status: 'running', args: { command: 'ls' } },
      { type: 'tool_call', call_id: 'c1', name: 'shell', status: 'completed', result: 'a.txt' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    ])
    const events: AgentEvent[] = []
    const runner = new CursorSession(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' },
      (e) => events.push(e),
      false,
      sdk,
    )
    runner.setTools({ url: 'http://127.0.0.1:1/mcp', token: 't', nativeSubagents: false })
    await runner.start('hi', null)
    await settle(events)
    expect(calls.create.local).toMatchObject({ cwd: '/work', sandboxOptions: { enabled: true } })
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

  it('turns a lost agent into ResumeUnavailable', async () => {
    const { sdk } = fakeCursor([])
    const runner = new CursorSession(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' }, () => {}, false, sdk)
    await expect(runner.start('hi', 'agent-old')).rejects.toBeInstanceOf(ResumeUnavailable)
  })
})

describe('OpenCode 2 helpers', () => {
  it('adds Ramu tools under mcp.servers without dropping the user config', () => {
    const env = openCodeServerEnv(
      { url: 'http://127.0.0.1:1/mcp', token: 't', nativeSubagents: false },
      JSON.stringify({ mcp: { servers: { mine: { type: 'remote', url: 'x' } } } }),
    )
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    expect(Object.keys(config.mcp.servers)).toEqual(['mine', 'ramu'])
    expect(config.mcp.servers.ramu.headers).toEqual({ Authorization: 'Bearer t' })
    // OpenCode 2 ignores the v1 `permission` key; the switch is a session permission.
    expect(config.permission).toBeUndefined()
    expect(openCodePermissions({ url: '', token: '', nativeSubagents: false })).toEqual([
      { action: 'task', resource: '*', effect: 'deny' },
    ])
    expect(openCodeServerEnv(undefined, undefined)).toEqual({})
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
