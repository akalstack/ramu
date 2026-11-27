import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type AgentSettings, type AgentSessionState } from '@ramu/shared/types'
import {
  alwaysAskHooks,
  claudeHooks,
  commandTurnHooks,
  createCanUseTool,
  readOnlyBashHooks,
} from '../src/agent/permissions'
import type { PendingRequest } from '../src/agent/types'

function fixture(access: AgentSettings['access'], restricted = false) {
  const pending = new Map<string, PendingRequest>()
  const events: AgentEvent[] = []
  const states: AgentSessionState[] = []
  const canUseTool = createCanUseTool({
    settings: { ...DEFAULT_AGENT_SETTINGS, access },
    pending,
    record: (event) => events.push(event),
    setState: (state) => states.push(state),
    restricted,
  })
  const call = (name: string, input: Record<string, unknown> = {}) =>
    canUseTool(name, input, { signal: new AbortController().signal, toolUseID: name, requestId: name })
  return { pending, events, states, call, canUseTool }
}

it('Auto permits direct and discovered Ramu tools without interrupting the turn', async () => {
  const { call, pending, events, states } = fixture('auto')
  for (const [tool, input] of [
    ['tool_invoke', { name: 'memory_search', arguments: { query: 'project' } }],
    ['ramu_agent', { prompt: 'Review the changes' }],
    ['schedule_create', { prompt: 'Review tomorrow' }],
    ['memory_save', { content: 'Use pnpm' }],
    ['ask_user', { questions: [] }],
  ] as const) {
    expect(await call(`mcp__ramu__${tool}`, input)).toEqual({ behavior: 'allow', updatedInput: input })
  }
  expect(pending.size).toBe(0)
  expect(events).toEqual([])
  expect(states).toEqual([])
})

it.each(['auto', 'edits'] as const)('%s still asks for commands and tools from other MCP servers', async (access) => {
  for (const name of ['Bash', 'mcp__external__tool_invoke', 'mcp__ramu_other__memory_save']) {
    const { call, pending, events, states } = fixture(access)
    const result = call(name, { command: 'do something' })
    expect(events).toEqual([expect.objectContaining({ kind: 'permission-request', toolName: name })])
    expect(states).toEqual(['needs-input'])
    const request = [...pending.values()][0]!
    request.resolve({ behavior: 'deny', message: 'Declined' })
    expect(await result).toMatchObject({ behavior: 'deny' })
  }
})

it('Allow edits keeps approval for Ramu mutations, and Full access permits them', async () => {
  const edits = fixture('edits')
  const result = edits.call('mcp__ramu__tool_invoke', { name: 'schedule_create', arguments: {} })
  expect(edits.events).toEqual([expect.objectContaining({ kind: 'permission-request' })])
  ;[...edits.pending.values()][0]!.resolve({ behavior: 'deny', message: 'Declined' })
  expect(await result).toMatchObject({ behavior: 'deny' })
  expect(await fixture('full').call('mcp__ramu__tool_invoke')).toMatchObject({ behavior: 'allow' })
})

it('Auto keeps native questions as questions rather than approving them', async () => {
  const { call, pending, events } = fixture('auto')
  const result = call('AskUserQuestion', { questions: [] })
  expect(events).toEqual([expect.objectContaining({ kind: 'question' })])
  ;[...pending.values()][0]!.resolve({ behavior: 'allow', updatedInput: { answers: {} } })
  expect(await result).toMatchObject({ updatedInput: { answers: {} } })
})

it('restricted reviews continue to deny non-Ramu tools even in Auto', async () => {
  const { call, events } = fixture('auto', true)
  expect(await call('Bash')).toMatchObject({ behavior: 'deny' })
  expect(await call('mcp__external__tool_invoke')).toMatchObject({ behavior: 'deny' })
  expect(await call('mcp__ramu__memory_read')).toMatchObject({ behavior: 'allow' })
  expect(events).toEqual([])
})

it('uses Claude SDK command suggestions and preserves the native once-only restriction', async () => {
  const { canUseTool, events, pending } = fixture('edits')
  const result = canUseTool(
    'Bash',
    { command: 'npm run test --watch' },
    {
      signal: new AbortController().signal,
      toolUseID: 'x',
      requestId: 'x',
      suppressAlwaysAllowRule: true,
      suggestions: [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'localSettings',
          rules: [
            { toolName: 'Bash', ruleContent: 'npm run test *' },
            { toolName: 'Bash', ruleContent: 'rm *' },
          ],
        },
      ],
    },
  )
  expect(events[0]).toMatchObject({ approvalOnceOnly: true, approvalPatterns: ['npm run test *'] })
  ;[...pending.values()][0]!.resolve({ behavior: 'deny', message: 'Declined' })
  await result
})

it('edits does not prompt again for computer or browser tools', async () => {
  const { call, pending, events } = fixture('edits')
  for (const [tool, input] of [
    ['computer_observe', {}],
    ['browser_navigate', { url: 'https://example.com' }],
    ['tool_invoke', { name: 'computer_click', arguments: {} }],
  ] as const)
    expect(await call(`mcp__ramu__${tool}`, input)).toEqual({ behavior: 'allow', updatedInput: input })
  expect(pending.size).toBe(0)
  expect(events).toEqual([])
})

it('Full access asks once for whatever Claude still sends it, while Ramu tools stay allowed', async () => {
  const { call, events, pending } = fixture('full')
  expect(await call('mcp__ramu__memory_save', {})).toMatchObject({ behavior: 'allow' })
  const result = call('Bash', { command: 'rm -rf ~/notes' })
  expect(events).toEqual([
    expect.objectContaining({
      kind: 'permission-request',
      approvalOnceOnly: true,
      approvalPatterns: undefined,
      approvalFullAccess: {},
    }),
  ])
  ;[...pending.values()][0]!.resolve({ behavior: 'deny', message: 'Declined' })
  expect(await result).toMatchObject({ behavior: 'deny' })
})

it('keeps the reason Full access asks out of the detail, so the card can explain it on request', async () => {
  const { canUseTool, events, pending } = fixture('full')
  const result = canUseTool(
    'Bash',
    { command: 'gh pr comment 1' },
    {
      signal: new AbortController().signal,
      toolUseID: 'Bash',
      requestId: 'Bash',
      decisionReason: 'Posts on a pull request in your name',
    },
  )
  expect(events[0]).toMatchObject({ approvalFullAccess: { reason: 'Posts on a pull request in your name' } })
  expect((events[0] as { detail: string }).detail).not.toContain('Posts on a pull request')
  ;[...pending.values()][0]!.resolve({ behavior: 'deny', message: 'Declined' })
  await result
})

it('asks before a production deploy at every access level, and leaves every other command to the access level', async () => {
  const hooks = claudeHooks({ PreToolUse: [] }, alwaysAskHooks())!
  const hook = hooks.PreToolUse![0]!.hooks[0]!
  const run = (command: string) =>
    hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } as never, 'id', {
      signal: new AbortController().signal,
    })
  expect(await run('cd web && vercel deploy --prod')).toMatchObject({
    hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'Deploys to production' },
  })
  // As T3 Code: the agent's own checks decide the rest (Claude's safety checks, Codex's judgement).
  expect(await run('vercel deploy')).toEqual({})
  expect(await run('rm -rf dist')).toEqual({})
  expect(await run('git push --force')).toEqual({})
  expect(claudeHooks(undefined, undefined)).toBeUndefined()
})

it('makes a command that can write take its turn, and lets one that only reads run at once', async () => {
  const held: string[] = []
  const hook = commandTurnHooks(async (id) => void held.push(id)).PreToolUse![0]!.hooks[0]!
  const run = (id: string, command: string) =>
    hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } as never, id, {
      signal: new AbortController().signal,
    })
  await run('read', 'git status --short && ls src')
  await run('write', 'pnpm format')
  expect(held).toEqual(['write'])
})

it('lets a read-only reviewer run commands that only read, anywhere, and refuses the rest with the reason', async () => {
  const hook = readOnlyBashHooks().PreToolUse![0]!.hooks[0]!
  const decide = async (command: string) =>
    (
      (await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } as never, 'id', {
        signal: new AbortController().signal,
      })) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string } }
    ).hookSpecificOutput
  for (const command of [
    'cd /Users/me/project && git log --oneline -5 | wc -l',
    'git diff HEAD~3 -- src',
    'cat package.json | head -50',
    'ls apps packages 2>/dev/null',
    'grep -rn TODO /abs/repo/src',
  ])
    expect((await decide(command)).permissionDecision, command).toBe('allow')
  for (const command of [
    'pnpm test',
    'rm -rf dist',
    'git commit -m x',
    'git diff --output=patch.txt',
    'echo hi > notes.md',
    'cat .env',
    'bash -c "ls"',
  ]) {
    const decision = await decide(command)
    expect(decision.permissionDecision, command).toBe('deny')
    expect(decision.permissionDecisionReason).toMatch(/read-only reviewer/)
  }
})

it('keeps file-changing tools away from a read-only session while Bash is decided by command', async () => {
  const pending = new Map<string, PendingRequest>()
  const canUseTool = createCanUseTool({
    settings: { ...DEFAULT_AGENT_SETTINGS, access: 'edits' },
    pending,
    record: () => {},
    setState: () => {},
    readOnly: true,
  })
  const call = (name: string, input: Record<string, unknown>) =>
    canUseTool(name, input, { signal: new AbortController().signal, toolUseID: name, requestId: name })
  expect(await call('Edit', {})).toMatchObject({ behavior: 'deny' })
  expect(await call('Bash', { command: 'git status' })).toMatchObject({ behavior: 'allow' })
  expect(await call('Bash', { command: 'npm install' })).toMatchObject({ behavior: 'deny' })
  expect(pending.size).toBe(0)
})

it('lets run_script through without a second card, since the gateway asks for each call inside it', async () => {
  const { call, pending, events } = fixture('edits')
  expect(await call('mcp__ramu__run_script', { code: 'return 1' })).toMatchObject({ behavior: 'allow' })
  expect(pending.size).toBe(0)
  expect(events).toEqual([])
})
