// Test-only stand-in for the Claude Agent SDK, enabled with RAMU_FAKE_AGENT=1. It exercises the
// same event, permission and transcript paths as the real adapter without spending model usage.
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFn } from './agent'
import type { McpConnection } from '../shared/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function fakeTools(text: string, connection?: McpConnection): Promise<void> {
  if (!connection || !text.includes('[schedule tool]') && !text.includes('<review-comments>')) return
  const client = new Client({ name: 'ramu-smoke', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }))
    if (text.includes('[schedule tool]')) {
      const context = await client.callTool({ name: 'schedule_context', arguments: {} })
      const data = JSON.parse((context.content as { text: string }[])[0]!.text)
      const result = await client.callTool({ name: 'schedule_create', arguments: { name: 'Created through chat tools', prompt: 'Summarize this chat', timezone: data.timezone ?? 'UTC', rule: { kind: 'once', at: new Date(Date.now() + 86400000).toISOString() }, missedPolicy: 'latest', settings: data.currentSettings } })
      if (result.isError) throw new Error(JSON.stringify(result.content))
    }
    const body = text.match(/<review-comments>\s*([\s\S]*?)\s*<\/review-comments>/)?.[1]
    if (body) for (const thread of JSON.parse(body)) {
      const result = await client.callTool({ name: 'review_reply', arguments: { reviewId: thread.reviewId, threadId: thread.threadId, text: 'Test agent examined the supplied feedback and code context.', suggestResolved: true } })
      if (result.isError) throw new Error(JSON.stringify(result.content))
    }
  } finally { await client.close() }
}

export function fakeAnalysis(prompt: string): string {
  if (prompt.includes('recap-items')) return '{"items":[]}'
  if (prompt.startsWith('chat-title:')) return prompt.match(/<first-message>\n([^\n]*)/)?.[1]?.slice(0, 60) ?? 'Chat'
  const data = prompt.match(/<change-data>\s*([\s\S]*?)\s*<\/change-data>/)?.[1]
  if (data) { const files = JSON.parse(data); return JSON.stringify({ summary: 'Test review completed.', findings: [], notes: files.length ? [{ fileId: files[0].id, scope: 'file', kind: 'question', text: 'Test question: should this change preserve compatibility?' }] : [] }) }
  return 'Update staged files'
}

const DEMO_TOOLS: [string, Record<string, string>, string][] = [
  ['Read', { file_path: 'src/auth/session.ts' }, 'export async function createSession(user: User) { … }'],
  ['Grep', { pattern: 'resetToken' }, 'No matches'],
  ['Edit', { file_path: 'src/auth/reset.ts' }, 'Updated src/auth/reset.ts'],
  ['Bash', { command: 'pnpm test auth' }, '✓ 12 tests passed'],
]
const DEMO_REPLY = `I added a password reset flow to the api.

- **\`POST /auth/reset\`** issues a single-use token that expires after 30 minutes.
- **\`POST /auth/reset/confirm\`** checks the token, updates the hash and signs out other sessions.
- Tokens are stored hashed, so a database leak can't be replayed.

\`\`\`ts
export async function confirmReset(token: string, password: string) {
  const record = await tokens.consume(hash(token))
  if (!record || record.expiresAt < Date.now()) throw new ResetExpired()
  await users.setPassword(record.userId, password)
}
\`\`\`

The auth tests pass. Want me to add the email template next?`

/** A representative turn for UI screenshots: several tools, then a formatted reply. */
async function* demoTurn(): AsyncGenerator<SDKMessage, void> {
  for (const [i, [name, input, output]] of DEMO_TOOLS.entries()) {
    const id = `demo-tool-${Date.now()}-${i}`
    yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } } as unknown as SDKMessage
    yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } } as unknown as SDKMessage
  }
  yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: DEMO_REPLY }] } } as unknown as SDKMessage
  yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.042 } as unknown as SDKMessage
}

export const fakeQuery: QueryFn = ({ prompt, options }) => {
  async function* run(): AsyncGenerator<SDKMessage, void> {
    yield { type: 'system', subtype: 'init', session_id: `fake-${Date.now()}`, model: 'fake-agent', cwd: options.cwd } as unknown as SDKMessage
    for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
      const text = typeof m.message.content === 'string' ? m.message.content : ''
      if (text.includes('[limit claude]')) {
        yield { type: 'result', subtype: 'success', is_error: true, result: 'usage limit reached', total_cost_usd: 0 } as unknown as SDKMessage
        continue
      }
      if (text.includes('[demo]') || process.env.RAMU_FAKE_DEMO === '1') {
        yield* demoTurn()
        continue
      }
      const input = { command: 'pwd' }
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'fake-tool', name: 'Bash', input }] } } as unknown as SDKMessage
      const res = await options.canUseTool!('Bash', input, { signal: options.abortController!.signal, toolUseID: 'fake-tool' } as never)
      const server = options.mcpServers?.ramu
      if (server && 'url' in server && 'headers' in server) await fakeTools(text, { url: server.url, token: server.headers?.Authorization?.replace(/^Bearer /, '') ?? '' })
      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fake-tool', content: res?.behavior === 'allow' ? options.cwd : 'denied' }] },
      } as unknown as SDKMessage
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `Fake agent in ${options.cwd} received: ${text}` }] } } as unknown as SDKMessage
      yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 } as unknown as SDKMessage
    }
  }
  return Object.assign(run(), { interrupt: async () => undefined }) as unknown as Query
}

/** Test-only Codex adapter; no account or model usage. */
export const fakeCodex: import('./codex').CodexFactory = (scope, settings, emit) => {
  let connection: McpConnection | undefined
  let stopped = false
  let resolvePermission: (() => void) | null = null
  const send = async (prompt: string) => {
    emit({ kind: 'state', state: 'running' })
    if (prompt.includes('[limit codex]')) {
      emit({ kind: 'result', isError: true, text: 'usageLimitExceeded', costUsd: null }, true)
      return
    }
    emit({ kind: 'tool-use', toolUseId: 'fake-codex-tool', name: 'Bash', summary: 'pwd' })
    if (settings.access !== 'full') await new Promise<void>((resolve) => {
      resolvePermission = resolve
      emit({ kind: 'permission-request', requestId: 'fake-codex-permission', toolName: 'Bash', title: 'Allow command?', detail: 'pwd' })
      emit({ kind: 'state', state: 'needs-input' })
    })
    if (stopped) return
    await fakeTools(prompt, connection)
    emit({ kind: 'tool-result', toolUseId: 'fake-codex-tool', isError: false, summary: scope.cwd })
    emit({ kind: 'text', text: `Fake Codex in ${scope.cwd} received: ${prompt}` })
    emit({ kind: 'result', isError: false, text: 'done', costUsd: null })
  }
  return {
    setTools: (tools) => { connection = tools },
    start: async (prompt, resume) => { emit({ kind: 'init', model: settings.model || 'fake-codex', cwd: scope.cwd, providerSessionId: resume || 'fake-codex-thread' }); void send(prompt) },
    send: async (prompt) => { void send(prompt) },
    steer: async (text) => { emit({ kind: 'text', text: `Steered: ${text}` }) },
    interrupt: async () => { emit({ kind: 'result', isError: false, text: 'interrupted', costUsd: null }) },
    stop: async () => { stopped = true; resolvePermission?.() },
    replyPermission: (requestId, allow) => { emit({ kind: 'request-resolved', requestId, outcome: allow ? 'allowed' : 'denied' }); resolvePermission?.() },
    replyQuestion: () => {},
  }
}
