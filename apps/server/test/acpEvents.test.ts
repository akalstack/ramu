import { expect, it } from 'vitest'
import { AcpEventEncoder, AcpEvents, nativeShell } from '../src/providers/acpEvents'
import { agentContent, inlineMedia } from '@ramu/shared/chat/agentContent'
import { toolKind } from '@ramu/shared/chat/agentTools'
import type { AgentEvent } from '@ramu/shared/types'
const chunk = (text: string, thinking = false) => ({
  sessionUpdate: thinking ? 'agent_thought_chunk' : 'agent_message_chunk',
  content: { type: 'text', text },
})

it('merges deltas within a block without moving reasoning or later answers before tools', () => {
  const decoder = new AcpEvents()
  const first = decoder.consume(chunk('I will '))[0]!
  expect(decoder.consume(chunk('inspect it.'))[0]).toMatchObject({
    text: 'I will inspect it.',
    messageId: (first as any).messageId,
  })
  decoder.consume({ sessionUpdate: 'tool_call', toolCallId: 'read', kind: 'read', title: 'Read config' })
  const thought = decoder.consume(chunk('Check ', true))[0]!
  expect(decoder.consume(chunk('imports.', true))[0]).toMatchObject({
    kind: 'thinking',
    text: 'Check imports.',
    messageId: (thought as any).messageId,
  })
  const answer = decoder.consume(chunk('Done'))[0]!
  expect((answer as any).messageId).not.toBe((first as any).messageId)
})
it('uses human descriptions while keeping command/input and optional tool names separate', () => {
  const decoder = new AcpEvents()
  const call = decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'cmd',
    kind: 'execute',
    title: 'Run unit tests',
    name: 'provider_shell',
    rawInput: { command: 'pnpm test', description: 'Check tests' },
  })[0]!
  expect(call).toMatchObject({
    kind: 'tool-use',
    name: 'provider_shell',
    title: 'Run unit tests',
    status: 'pending',
    toolKind: 'execute',
  })
  expect((call as any).input).toContain('pnpm test')
  const update = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'cmd',
    name: null,
    rawInput: null,
    status: 'in_progress',
  })[0]!
  expect(update).toMatchObject({ name: 'provider_shell', title: 'Run unit tests', input: (call as any).input })
})
it('retains live content, replaces snapshots, and rejects late progress after completion', () => {
  const decoder = new AcpEvents()
  decoder.consume({ sessionUpdate: 'tool_call', toolCallId: 'cmd', title: 'Run', kind: 'execute' })
  const live = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'cmd',
    status: 'in_progress',
    content: [{ type: 'content', content: { type: 'text', text: 'first' } }],
  })
  expect(live[1]).toMatchObject({ kind: 'tool-result', summary: 'first', running: true })
  expect(decoder.consume({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd', content: [] })[1]).toMatchObject({
    summary: '',
    content: [],
  })
  expect(
    decoder.consume({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'cmd',
      status: 'failed',
      rawOutput: 'command failed',
    })[1],
  ).toMatchObject({ isError: true, running: false, summary: 'command failed' })
  expect(decoder.consume({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd', status: 'in_progress' })).toEqual([])
})
it('does not drop media, diffs, embedded resources, terminals, or unknown content', () => {
  const content = agentContent([
    { type: 'content', content: { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' } },
    { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' },
    { type: 'resource', resource: { uri: 'file:///work/a.txt', mimeType: 'text/plain', text: 'resource text' } },
    { type: 'resource_link', uri: 'https://example.com/report', name: 'Report' },
    { type: 'diff', path: '/work/a.ts', oldText: 'old', newText: 'new' },
    { type: 'terminal', terminalId: 'terminal-1' },
    { type: 'new-provider-content', value: 'x' },
  ])
  expect(content.map((c) => c.type)).toEqual([
    'image',
    'audio',
    'resource',
    'resource',
    'diff',
    'terminal',
    'unsupported',
  ])
  expect(content[2]).toMatchObject({ text: 'resource text' })
  const decoder = new AcpEvents()
  expect(
    decoder.consume({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    })[0],
  ).toMatchObject({ kind: 'content', content: [content[0]] })
})
it('keeps plans in one turn-scoped row and converts context usage', () => {
  const decoder = new AcpEvents()
  const plan = decoder.consume({
    sessionUpdate: 'plan',
    entries: [{ content: 'Inspect', status: 'in_progress', priority: 'high' }],
  })[0]!
  expect(
    decoder.consume({
      sessionUpdate: 'plan',
      entries: [{ content: 'Inspect', status: 'completed', priority: 'high' }],
    })[0],
  ).toMatchObject({ messageId: (plan as any).messageId })
  expect(decoder.consume({ sessionUpdate: 'usage_update', used: 150, size: 1000 })).toEqual([
    { kind: 'context', used: 150, max: 1000 },
  ])
})
it('native envelopes preserve exact metadata without also creating duplicate standard events', () => {
  const encoder = new AcpEventEncoder(),
    decoder = new AcpEvents(true)
  const event: AgentEvent = {
    kind: 'tool-use',
    toolUseId: 'one',
    name: 'Bash',
    title: 'Check status',
    summary: 'git status',
    input: '{"command":"git status"}',
    toolKind: 'execute',
    agentId: 'child',
  }
  const encoded = encoder.encode(event)
  expect(encoded).toMatchObject({ sessionUpdate: 'tool_call', title: 'Check status', kind: 'execute' })
  expect(decoder.consume(encoded)).toEqual([event])
  const thought: AgentEvent = { kind: 'thinking', messageId: 'thought', text: 'Consider this' }
  expect(encoder.encode(thought)).toMatchObject({
    sessionUpdate: 'agent_thought_chunk',
    content: { text: 'Consider this' },
  })
  expect(encoder.encode({ ...thought, text: 'Consider this next' })).toMatchObject({ content: { text: ' next' } })
})
it('supports Claude image sources and OpenCode data URIs while refusing unsafe inline formats', () => {
  expect(
    agentContent({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }),
  ).toEqual([{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }])
  expect(agentContent({ type: 'image', uri: 'data:image/png;base64,aGVsbG8=' })).toEqual([
    { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
  ])
  expect(inlineMedia('image/svg+xml', 'aGVsbG8=', 'image')).toBeUndefined()
  expect(inlineMedia('image/png', '<script>', 'image')).toBeUndefined()
  expect(inlineMedia('image/png', 'aGVsbG8=', 'image')).toBe('data:image/png;base64,aGVsbG8=')
  expect(toolKind({ name: 'Read', toolKind: 'think' })).toBe('think')
})

it('shows OpenCode sub-agent calls as task cards and ignores them for other providers', () => {
  const decoder = new AcpEvents(false, ['task', 'subagent'])
  const started = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call',
    name: 'subagent',
    kind: 'think',
    status: 'in_progress',
    rawInput: { description: 'Say hi', agent: 'general', prompt: 'reply hi' },
  })
  expect(started.find((e) => e.kind === 'agent')).toMatchObject({
    agentId: 'call',
    toolUseId: 'call',
    name: 'Say hi',
    agentType: 'general',
    prompt: 'reply hi',
    status: 'running',
    taskType: 'local_agent',
  })
  const done = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call',
    status: 'completed',
    content: [
      {
        type: 'content',
        content: { type: 'text', text: '<subagent sessionID="ses_1" state="completed">\nhi\n</subagent>' },
      },
    ],
  })
  expect(done.find((e) => e.kind === 'agent')).toMatchObject({ name: 'Say hi', status: 'completed', summary: 'hi' })
  expect(
    new AcpEvents()
      .consume({ sessionUpdate: 'tool_call', toolCallId: 'x', name: 'subagent', status: 'pending' })
      .some((e) => e.kind === 'agent'),
  ).toBe(false)
})

it('recognises Cursor sub-agents by the tool named in their input', () => {
  const decoder = new AcpEvents(false, ['task', 'subagent'])
  const call = decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'c\nfc_1',
    title: 'Task: Reply with hi',
    kind: 'other',
    status: 'pending',
    rawInput: {
      _toolName: 'task',
      prompt: 'reply hi',
      description: 'Reply with hi',
      subagentType: { unspecified: {} },
    },
  })
  expect(call.find((e) => e.kind === 'agent')).toMatchObject({
    name: 'Reply with hi',
    status: 'running',
    prompt: 'reply hi',
  })
  expect((call.find((e) => e.kind === 'agent') as any).agentType).toBeUndefined()
  expect(
    decoder
      .consume({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c\nfc_1',
        status: 'completed',
        rawOutput: { durationMs: 10 },
      })
      .find((e) => e.kind === 'agent'),
  ).toMatchObject({ status: 'completed' })
  expect(
    decoder
      .consume({
        sessionUpdate: 'tool_call',
        toolCallId: 'other',
        title: 'Run',
        kind: 'execute',
        rawInput: { _toolName: 'shell' },
      })
      .some((e) => e.kind === 'agent'),
  ).toBe(false)
})

it('attaches child-session updates to the sub-agent card with the same description', () => {
  const decoder = new AcpEvents(false, ['subagent'])
  decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call',
    name: 'subagent',
    status: 'in_progress',
    rawInput: { description: 'Run ls', agent: 'general', prompt: 'x' },
  })
  const meta = { 'opencode/child-session': { id: 'child' } }
  const shell = decoder.consumeChild('child', 'Run ls', {
    sessionUpdate: 'tool_call',
    toolCallId: 'child:1',
    name: 'shell',
    title: 'ls',
    kind: 'execute',
    status: 'pending',
    _meta: meta,
  })
  expect(shell[0]).toMatchObject({ kind: 'tool-use', toolUseId: 'child:1', agentId: 'call' })
  const first = decoder.consumeChild('child', 'Run ls', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'h' },
  })
  expect(
    decoder.consumeChild('child', 'Run ls', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'i' },
    })[0],
  ).toMatchObject({ kind: 'text', text: 'hi', agentId: 'call', messageId: (first[0] as any).messageId })
  expect(decoder.consumeChild('stranger', 'Other', { sessionUpdate: 'usage_update', used: 1, size: 2 })).toEqual([])
})

it('maps Antigravity invoke_subagent permission calls to one card and ignores its odd launcher failure', () => {
  const decoder = new AcpEvents(false, ['invoke_subagent'])
  const started = decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'agy',
    title: 'Run invoke_subagent?',
    kind: 'other',
    status: 'pending',
    rawInput: { Subagents: [{ Prompt: 'reply hi', Role: 'Assistant', TypeName: 'self' }] },
  })
  expect(started.find((e) => e.kind === 'agent')).toMatchObject({
    name: 'reply hi',
    prompt: 'reply hi',
    agentType: 'Assistant',
    status: 'running',
    canStop: true,
  })
  const done = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'agy',
    status: 'failed',
    rawOutput: 'Tool call was approved but never executed.',
  })
  expect(done.find((e) => e.kind === 'agent')).toMatchObject({ status: 'completed', canStop: false })
  expect((done.find((e) => e.kind === 'agent') as any).error).toBeUndefined()
  expect(
    decoder
      .consume({ sessionUpdate: 'tool_call', toolCallId: 'x', title: 'Running start_subagent', kind: 'other' })
      .some((e) => e.kind === 'agent'),
  ).toBe(false)
})
it('merges out-of-band sub-agent details and keeps a stopped card stopped', () => {
  const decoder = new AcpEvents(false, ['task'])
  decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'c',
    name: 'task',
    status: 'in_progress',
    rawInput: { description: 'Survey' },
  })
  expect(decoder.updateAgent('c', { durationMs: 2637, address: 'agent-1' })).toMatchObject({
    kind: 'agent',
    name: 'Survey',
    durationMs: 2637,
    address: 'agent-1',
  })
  expect(decoder.updateAgent('missing', { durationMs: 1 })).toBeUndefined()
  decoder.updateAgent('c', { status: 'stopped' })
  expect(
    decoder
      .consume({ sessionUpdate: 'tool_call_update', toolCallId: 'c', status: 'failed' })
      .find((e) => e.kind === 'agent'),
  ).toMatchObject({ status: 'stopped' })
})

it('reports an Antigravity helper as failed when its start_subagent step fails', () => {
  const decoder = new AcpEvents(false, ['invoke_subagent'])
  decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'agy',
    title: 'Run invoke_subagent?',
    status: 'pending',
    rawInput: { Subagents: [{ Prompt: 'reply hi' }] },
  })
  decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 's:1',
    title: 'Running start_subagent',
    status: 'in_progress',
    rawInput: {},
  })
  decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's:1',
    status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text: 'Tool execution failed' } }],
  })
  const done = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'agy',
    status: 'failed',
    rawOutput: 'Tool call was approved but never executed.',
  })
  expect(done.find((e) => e.kind === 'agent')).toMatchObject({ status: 'failed', error: 'Tool execution failed' })
})

it("shows Cursor's todo list as a plan, patching it on merge and ignoring malformed entries", () => {
  const decoder = new AcpEvents()
  const first = decoder.updateTodos({
    todos: [
      { id: 'a', content: 'Read the config', status: 'in_progress' },
      { id: 'b', content: 'Fix the bug', status: 'pending' },
      { id: 'c' },
      null,
    ],
    merge: false,
  })[0]!
  expect(first).toMatchObject({
    kind: 'plan',
    entries: [
      { content: 'Read the config', status: 'in_progress' },
      { content: 'Fix the bug', status: 'pending' },
    ],
  })
  const patched = decoder.updateTodos({
    todos: [
      { id: 'a', content: 'Read the config', status: 'completed' },
      { id: 'd', content: 'Ship it', status: 'cancelled' },
    ],
    merge: true,
  })[0]!
  expect(patched).toMatchObject({
    messageId: (first as any).messageId,
    entries: [
      { content: 'Read the config', status: 'completed' },
      { content: 'Fix the bug', status: 'pending' },
      { content: 'Ship it', status: 'completed' },
    ],
  })
  expect(
    decoder.updateTodos({ todos: [{ id: 'z', content: 'Only this', status: 'pending' }], merge: false })[0],
  ).toMatchObject({ entries: [{ content: 'Only this' }] })
  expect(decoder.updateTodos({ todos: 'nope' })).toEqual([])
  decoder.beginTurn()
  expect(
    decoder.updateTodos({ todos: [{ id: 'z', content: 'Only this', status: 'completed' }], merge: true })[0],
  ).not.toMatchObject({ messageId: (first as any).messageId })
})

it("shows Antigravity's shell calls as commands with their output, and drops inline image bytes", () => {
  const decoder = new AcpEvents()
  const started = decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 's1',
    title: 'Running run_command',
    status: 'in_progress',
    rawInput: { CommandLine: 'pnpm test', Cwd: '/repo' },
  })
  expect(started[0]).toMatchObject({ kind: 'tool-use', title: 'pnpm test', toolKind: 'execute' })
  const done = decoder.consume({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's1',
    status: 'completed',
    rawOutput: {
      combinedOutput: 'ok\n3 passed',
      formatted_output: 'ok\n3 passed',
      exitCode: 0,
      imagePath: '/tmp/a.png',
    },
  })
  expect(done.find((e) => e.kind === 'tool-result')).toMatchObject({ isError: false, summary: 'ok\n3 passed' })
  expect(done[0]).toMatchObject({
    title: 'pnpm test',
    toolKind: 'execute',
    content: [{ type: 'text', text: 'ok\n3 passed' }],
  })
  expect(JSON.stringify(done)).not.toContain('formatted_output')
  const shot = decoder.consume({
    sessionUpdate: 'tool_call',
    toolCallId: 'p1',
    title: 'Screenshot',
    status: 'completed',
    rawOutput: {
      type: 'image',
      mimeType: 'image/png',
      data: 'A'.repeat(5000),
      caption: 'kept',
      inline: `data:image/png;base64,${'B'.repeat(5000)}`,
    },
  })
  expect(JSON.stringify(shot)).not.toContain('AAAA')
  expect(JSON.stringify(shot)).not.toContain('BBBB')
  expect(JSON.stringify(shot)).toContain('kept')
  expect(nativeShell({ other: 1 }, { nothing: true })).toBeUndefined()
})
