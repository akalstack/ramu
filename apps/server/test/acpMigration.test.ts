import { afterEach, expect, it, vi } from 'vitest'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { acpHostedRunner } from '../src/providers/acpNativeHost'
import { claudeAcpQuery } from '../src/providers/claudeAcpQuery'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'
import type { AgentRunner } from '../src/agent/agentRunner'

let close: (() => void | Promise<void>) | undefined
const until = async (check: () => boolean) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 4000) throw new Error('ACP event timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
afterEach(async () => {
  await close?.()
  close = undefined
})

it('sends prompts over ACP and retains usage, patches, helper ownership and terminal errors', async () => {
  const events: AgentEvent[] = [],
    limits: boolean[] = []
  const native = {
    start: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    replyPermission: vi.fn(),
    replyQuestion: vi.fn(),
    setTools: vi.fn(),
  }
  let publish!: (event: AgentEvent, limit?: boolean) => void
  const runner = acpHostedRunner((scope, settings, emit) => {
    expect(scope.additionalDirs).toEqual(['/extra'])
    expect(settings.access).toBe('edits')
    publish = emit
    return native
  })(
    { cwd: '/workspace', additionalDirs: ['/extra'], covers: ['/workspace'] },
    { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits', accountId: 'work' },
    (event, limit) => {
      events.push(event)
      if (limit) limits.push(limit)
    },
  )
  close = () => runner.stop()
  await runner.start('first', 'native-history')
  await until(() => native.start.mock.calls.length === 1)
  expect(native.start).toHaveBeenCalledWith('first', 'native-history', [])
  const preserved: AgentEvent[] = [
    { kind: 'thinking', text: 'Exposed provider reasoning', messageId: 'reason' },
    { kind: 'content', messageId: 'image', content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] },
    {
      kind: 'tool-use',
      toolUseId: 'rich-tool',
      name: 'Bash',
      summary: 'pnpm test',
      title: 'Run the tests',
      input: '{"command":"pnpm test"}',
      toolKind: 'execute',
    },
    {
      kind: 'tool-result',
      toolUseId: 'rich-tool',
      summary: 'a.ts',
      isError: false,
      content: [{ type: 'diff', path: '/workspace/a.ts', oldText: 'old', newText: 'new' }],
    },
    {
      kind: 'usage',
      readings: [
        {
          provider: 'codex',
          window: 'five_hour',
          usedPercent: 95,
          resetsAt: 1900000000000,
          updatedAt: Date.now(),
          status: 'limited',
        },
      ],
    } as AgentEvent,
    {
      kind: 'tool-result',
      toolUseId: 'child:patch',
      summary: 'live patch',
      isError: false,
      running: true,
      agentId: 'child',
    },
    { kind: 'turn-diff', turnId: 'child:turn', diff: 'diff --git a/a b/a', agentId: 'child' },
    {
      kind: 'question',
      requestId: 'question',
      async: true,
      questions: [
        { question: 'Choose?', header: 'Choice', multiSelect: false, options: [{ label: 'A', description: '' }] },
      ],
    } as AgentEvent,
  ]
  for (const event of preserved) publish(event)
  publish({ kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }, true)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(events).toEqual([...preserved, { kind: 'result', isError: true, text: 'usage_limit_reached', costUsd: null }])
  expect(limits).toEqual([true])
  runner.replyQuestion('question', { 'Choose?': 'A' })
  await until(() => native.replyQuestion.mock.calls.length === 1)
  expect(native.replyQuestion).toHaveBeenCalledWith('question', { 'Choose?': 'A' })
  await runner.steer('change direction')
  expect(native.steer).toHaveBeenCalledWith('change direction', [])
})

it('uses an ACP permission request and sends denial to the owning native runner', async () => {
  const events: AgentEvent[] = []
  let publish!: (event: AgentEvent) => void
  const native: AgentRunner = {
    start: async () => {
      publish({
        kind: 'permission-request',
        requestId: 'write',
        toolName: 'Write',
        title: 'Write file?',
        detail: '/workspace/a',
      })
    },
    send: async () => {},
    steer: async () => {},
    stop: async () => {},
    interrupt: async () => {},
    replyQuestion: () => {},
    replyPermission: vi.fn((_id, allow) => {
      expect(allow).toBe(false)
      publish({ kind: 'result', isError: false, text: 'Denied write', costUsd: null })
    }),
  }
  const runner = acpHostedRunner((_scope, _settings, emit) => {
    publish = emit
    return native
  })({ cwd: '/workspace', additionalDirs: [], covers: [] }, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' }, (event) =>
    events.push(event),
  )
  close = () => runner.stop()
  await runner.start('write', null)
  await until(() => events.some((event) => event.kind === 'permission-request'))
  runner.replyPermission('write', false)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(native.replyPermission).toHaveBeenCalledWith('write', false)
})

it('Claude ACP retains SDK messages and scopes context, usage, helper Stop and permissions to its owning Query', async () => {
  const stopTask = vi.fn(async () => {}),
    permission = vi.fn(async () => ({ behavior: 'deny' as const, message: 'deny write' }))
  const nativeQuery = vi.fn(({ prompt, options }) => {
    const result = {
      async *[Symbol.asyncIterator]() {
        for await (const user of prompt) {
          if (options.canUseTool)
            expect(
              await options.canUseTool(
                'Write',
                { file_path: '/a' },
                { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'permission' },
              ),
            ).toMatchObject({ behavior: 'deny' })
          yield {
            type: 'assistant',
            uuid: 'native-message',
            session_id: 'native-parent',
            parent_tool_use_id: null,
            message: { content: [{ type: 'text', text: user.message.content }] },
          } as unknown as SDKMessage
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'done',
            session_id: 'native-parent',
          } as SDKMessage
        }
      },
      supportedModels: async () => [{ value: 'model', displayName: 'Model' }],
      getContextUsage: async () => ({ totalTokens: 42, maxTokens: 1000 }),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
        rate_limits: { five_hour: { utilization: 95 } },
      }),
      backgroundTasks: async () => true,
      stopTask,
      interrupt: async () => {},
      close: vi.fn(),
    }
    return result as unknown as Query
  })
  const query = claudeAcpQuery(nativeQuery)({
    prompt: (async function* () {
      yield { type: 'user' as const, parent_tool_use_id: null, message: { role: 'user' as const, content: 'hello' } }
    })(),
    options: { cwd: '/workspace', canUseTool: permission, tools: [], persistSession: false },
  })
  close = () => query.close()
  expect(await query.supportedModels()).toMatchObject([{ value: 'model' }])
  expect(await query.getContextUsage({ detail: 'summary' })).toMatchObject({ totalTokens: 42 })
  expect(await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })).toMatchObject({
    rate_limits: { five_hour: { utilization: 95 } },
  })
  await query.stopTask('native-child')
  expect(stopTask).toHaveBeenCalledWith('native-child')
  const messages = []
  for await (const message of query) messages.push(message)
  expect(messages.map((message) => message.type)).toEqual(['assistant', 'result'])
  expect(messages[0]?.uuid).toBe('native-message')
  expect(permission).toHaveBeenCalledOnce()
  expect(nativeQuery).toHaveBeenCalledOnce()
})
