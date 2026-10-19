import { permissionKey } from '../agent/permissionApprovals'
// Test-only stand-in for the Claude Agent SDK, enabled with RAMU_FAKE_AGENT=1. It exercises the
// same event, permission and transcript paths as the real adapter without spending model usage.
import { randomUUID } from 'node:crypto'
import { elicitationRequest, elicitationContent } from '../agent/elicitation'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFn } from '../agent'
import type { McpConnection, AgentElicitation, ElicitationAction } from '@ramu/shared/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function fakeTools(text: string, connection?: McpConnection): Promise<void> {
  if (
    !connection ||
    (!text.includes('[skill install]') &&
      !text.includes('[schedule tool]') &&
      !text.includes('<review-comments>') &&
      !text.includes('[ramu-agent') &&
      !text.includes('[questions') &&
      !text.includes('[advisor') &&
      !text.includes('[goal tool]'))
  )
    return
  const client = new Client({ name: 'ramu-smoke', version: '1' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(connection.url), {
        requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
      }),
    )
    const exposed = new Set((await client.listTools()).tools.map((tool) => tool.name))
    const call = async (request: Parameters<Client['callTool']>[0]) => {
      if (exposed.has(request.name)) return client.callTool(request)
      const found = await client.callTool({ name: 'tool_search', arguments: { query: request.name, limit: 5 } })
      const block = found.content as { type: string; text?: string }[]
      if (!block.some((item) => item.text?.includes(request.name)))
        throw new Error(`Ramu tool not discovered: ${request.name}`)
      return client.callTool({
        name: 'tool_invoke',
        arguments: { name: request.name, arguments: request.arguments ?? {} },
      })
    }
    if (text.includes('[skill install]')) {
      const source = /<skill-source>(.*?)<\/skill-source>/.exec(text)?.[1]
      if (!source) throw new Error('Skill fixture needs a source')
      const reply = await call({ name: 'skill_install', arguments: { source, scope: 'project' } })
      if (reply.isError) throw new Error(JSON.stringify(reply.content))
    }
    if (text.includes('[goal tool]')) {
      const continuation = text.startsWith('Ramu goal continuation:')
      const reply = await call(
        continuation
          ? {
              name: 'update_goal',
              arguments: {
                status: 'completed',
                reason: 'The smoke fixture verified goal tools, persistence and automatic continuation.',
              },
            }
          : {
              name: 'set_goal',
              arguments: {
                objective: 'Verify the goal smoke fixture [goal tool]',
                continuationReason: 'The smoke fixture checks automatic continuation, so it needs a second turn.',
              },
            },
      )
      if (reply.isError) throw new Error(JSON.stringify(reply.content))
    }
    if (text.includes('[questions')) {
      const reply = await call({
        name: 'ask_user',
        arguments: {
          grouping: text.includes('[questions independent]') ? 'independent' : 'together',
          dependsOn: 'Choose the database and deployment region',
          questions: [
            { id: 'database', question: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres' }] },
            { id: 'region', question: 'Which region?', options: [{ label: 'Jakarta' }, { label: 'Singapore' }] },
          ],
        },
      })
      if (reply.isError) throw new Error(JSON.stringify(reply.content))
      const data = JSON.parse((reply.content as { text: string }[])[0]!.text)
      if (text.includes('[questions obsolete]'))
        await call({
          name: 'close_question',
          arguments: { requestId: data.request.requestId, reason: 'The requested work no longer needs a database.' },
        })
      if (text.includes('[questions wait]'))
        await call({ name: 'wait_for_answer', arguments: { requestId: data.request.requestId } })
    }
    if (text.includes('[advisor')) {
      const reply = await call({
        name: 'advisor',
        arguments: { focus: 'Is the plan sound?', wait: !text.includes('[advisor async]') },
      })
      if (reply.isError) throw new Error(JSON.stringify(reply.content))
    }
    if (text.includes('[schedule tool]')) {
      const context = await call({ name: 'schedule_context', arguments: {} })
      const data = JSON.parse((context.content as { text: string }[])[0]!.text)
      const result = await call({
        name: 'schedule_create',
        arguments: {
          name: 'Created through thread tools',
          prompt: 'Summarize this thread',
          timezone: data.timezone ?? 'UTC',
          rule: { kind: 'once', at: new Date(Date.now() + 86400000).toISOString() },
          missedPolicy: 'latest',
          settings: data.currentSettings,
        },
      })
      if (result.isError) throw new Error(JSON.stringify(result.content))
    }
    if (text.includes('[ramu-agent')) {
      const result = await call({
        name: 'ramu_agent',
        arguments: {
          description: 'Survey the tests',
          prompt: 'List the test files',
          type: 'Explore',
          background: text.includes('[ramu-agent background]'),
        },
      })
      if (result.isError) throw new Error(JSON.stringify(result.content))
    }
    const body = text.match(/<review-comments>\s*([\s\S]*?)\s*<\/review-comments>/)?.[1]
    if (body)
      for (const thread of JSON.parse(body)) {
        const result = await call({
          name: 'review_reply',
          arguments: {
            reviewId: thread.reviewId,
            threadId: thread.threadId,
            text: 'Test agent examined the supplied feedback and code context.',
            suggestResolved: true,
          },
        })
        if (result.isError) throw new Error(JSON.stringify(result.content))
      }
  } finally {
    await client.close()
  }
}

export function fakeAnalysis(prompt: string): string {
  if (prompt.startsWith('ramu-learning:') && prompt.includes('[learn-fixture]'))
    return JSON.stringify({
      checkpoint: 'Fixture checks completed; no deployment performed.',
      memories: [
        {
          kind: 'feedback',
          title: 'Retry fixture guidance',
          content: 'Use bounded retries for this fixture; verify with its retry test.',
          tags: ['retry'],
          importance: 3,
          reason: 'Observed simulated test result',
        },
      ],
      skills: [
        {
          name: 'fixture-retry-check',
          description: 'Verify bounded retries in the fixture',
          content: 'Inspect the retry limit. Run its tests. Report failures accurately.',
          reason: 'Verified reusable fixture procedure',
        },
      ],
      archive: [],
    })
  if (prompt.startsWith('ramu-learning:'))
    return '{"checkpoint":"Completed simulated work; verify real changes separately.","memories":[],"skills":[],"archive":[]}'
  if (prompt.includes('recap-items')) return '{"items":[]}'
  if (prompt.startsWith('aside:'))
    return `Side answer: ${prompt.match(/<question>\n([\s\S]*?)\n<\/question>/)?.[1] ?? ''}`.trim()
  if (prompt.startsWith('advisor:'))
    return `Advisor review: ${prompt.match(/<agent-focus>\n([\s\S]*?)\n<\/agent-focus>/)?.[1] ?? 'general check'}. Verify the tests before declaring done.`
  if (prompt.startsWith('theme-draft:')) {
    // A warm paper-and-ink fixture that passes the readability checks, so the AI theme flow is testable offline.
    const seed = JSON.parse(prompt.match(/<seed-theme>\n([\s\S]*?)\n<\/seed-theme>/)![1]!)
    const warm = (variant: 'light' | 'dark', colors: Record<string, string>) => ({
      overlay: seed[variant].overlay,
      colors: { ...seed[variant].colors, ...colors },
    })
    return JSON.stringify({
      name: 'Warm paper',
      light: warm('light', {
        window: '#efe6d8',
        canvas: '#fbf6ec',
        raised: '#fffaf0',
        subtle: '#f1e8d8',
        bubble: '#eadfca',
      }),
      dark: warm('dark', {
        window: '#1a1511',
        canvas: '#221c17',
        raised: '#2e2620',
        subtle: '#2e2620',
        bubble: '#372e26',
      }),
    })
  }
  if (prompt.startsWith('chat-title:')) return prompt.match(/<first-message>\n([^\n]*)/)?.[1]?.slice(0, 60) ?? 'Thread'
  const data = prompt.match(/<change-data>\s*([\s\S]*?)\s*<\/change-data>/)?.[1]
  if (data) {
    const files = JSON.parse(data)
    return JSON.stringify({
      summary: 'Test review completed.',
      findings: [],
      notes: files.length
        ? [
            {
              fileId: files[0].id,
              scope: 'file',
              kind: 'question',
              text: 'Test question: should this change preserve compatibility?',
            },
          ]
        : [],
    })
  }
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

const RICH_REPLY = `## Password reset: what changed

The reset flow now lives in \`src/auth/reset.ts\` and follows the [OWASP cheat sheet](https://cheatsheetseries.owasp.org/). Start in @src/auth/reset.ts:42, see [the tests](src/auth/reset.test.ts), the folder @apps/web/src and the $review skill. Here is how the endpoints compare:

| Endpoint | Method | Auth | Rate limit |
| --- | :---: | --- | ---: |
| \`/auth/reset\` | POST | none | 5 / hour |
| \`/auth/reset/confirm\` | POST | token | 10 / hour |
| \`/auth/sessions\` | DELETE | session | 60 / min |

> Tokens are stored hashed, so a database leak can't be replayed.

1. Request a token with the account email.
2. Confirm it within **30 minutes**.
3. Every other session is signed out.

- [x] Single-use tokens
- [x] Hashed at rest
- [ ] Email template

\`\`\`ts
export async function confirmReset(token: string, password: string) {
  const record = await tokens.consume(hash(token))
  if (!record || record.expiresAt < Date.now()) throw new ResetExpired()
  await users.setPassword(record.userId, password)
}
\`\`\`

---

Want me to add the email template next?`

/** A representative turn for UI screenshots: several tools, then a formatted reply. */
async function* demoTurn(reply = DEMO_REPLY): AsyncGenerator<SDKMessage, void> {
  for (const [i, [name, input, output]] of DEMO_TOOLS.entries()) {
    const id = `demo-tool-${Date.now()}-${i}`
    yield {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id, name, input }] },
    } as unknown as SDKMessage
    yield {
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] },
    } as unknown as SDKMessage
  }
  yield {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: reply }] },
  } as unknown as SDKMessage
  yield {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    total_cost_usd: 0.042,
  } as unknown as SDKMessage
}

const msg = (value: unknown) => value as SDKMessage
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A turn that starts a background sub-agent which keeps working, and reports back, after the turn ends. */
async function* agentsTurn(stopped: Set<string>, delayMs: number): AsyncGenerator<SDKMessage, void> {
  const call = `agent-call-${Date.now()}`,
    task = `task-${Date.now()}`
  const sub = (content: unknown[], role: 'assistant' | 'user' = 'assistant') =>
    msg({ type: role, parent_tool_use_id: call, agent_id: task, message: { role, content } })
  yield msg({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'tool_use',
          id: call,
          name: 'Agent',
          input: {
            description: 'Map the auth module',
            prompt: 'List every file in src/auth and what it exports.',
            subagent_type: 'Explore',
            run_in_background: true,
            name: 'auth-mapper',
          },
        },
      ],
    },
  })
  yield msg({
    type: 'system',
    subtype: 'task_started',
    task_id: task,
    tool_use_id: call,
    description: 'Map the auth module',
    subagent_type: 'Explore',
    task_type: 'local_agent',
    is_backgrounded: true,
    prompt: 'List every file in src/auth and what it exports.',
  })
  yield msg({
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call, content: 'Async agent launched (auth-mapper).' }],
    },
  })
  yield sub([
    { type: 'text', text: 'Looking through `src/auth` first.' },
    { type: 'tool_use', id: `${task}-read`, name: 'Read', input: { file_path: 'src/auth/session.ts' } },
  ])
  yield sub([{ type: 'tool_result', tool_use_id: `${task}-read`, content: 'export const session = 1' }], 'user')
  yield msg({
    type: 'system',
    subtype: 'task_progress',
    task_id: task,
    tool_use_id: call,
    description: 'Map the auth module',
    usage: { total_tokens: 1800, tool_uses: 1, duration_ms: 900 },
    last_tool_name: 'Read',
    summary: 'Reading session.ts',
  })
  yield msg({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'text',
          text: 'I started a background agent to map the auth module. It will report back when it is done.',
        },
      ],
    },
  })
  yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01 })
  await sleep(delayMs)
  if (stopped.has(task)) {
    yield msg({
      type: 'system',
      subtype: 'task_notification',
      task_id: task,
      tool_use_id: call,
      status: 'stopped',
      output_file: '',
      summary: 'Stopped',
    })
    return
  }
  yield sub([{ type: 'text', text: '`src/auth/session.ts` exports `session`. Nothing else lives there yet.' }])
  yield msg({
    type: 'system',
    subtype: 'task_notification',
    task_id: task,
    tool_use_id: call,
    status: 'completed',
    output_file: '',
    summary: 'src/auth has one file, session.ts, exporting `session`.',
    usage: { total_tokens: 3200, tool_uses: 1, duration_ms: delayMs + 900 },
  })
  yield msg({ type: 'system', subtype: 'init', session_id: `fake-${Date.now()}`, model: 'fake-agent', cwd: '' })
  yield msg({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'text',
          text: 'The auth-mapper agent finished: `src/auth` has one file, `session.ts`, which exports `session`.',
        },
      ],
    },
  })
  yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01 })
}

/** Ramu's own tools as a chat shows them: some have a card elsewhere and stay out of the transcript, the rest read as plain rows. Several sub-agents start side by side. */
async function* ramuToolsTurn(): AsyncGenerator<SDKMessage, void> {
  const stamp = Date.now()
  const use = (id: string, name: string, input: unknown) =>
    msg({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: `${id}-${stamp}`, name, input }] },
    })
  const done = (id: string, content: string, isError = false) =>
    msg({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `${id}-${stamp}`, content, is_error: isError }],
      },
    })
  yield use('goal', 'mcp__ramu__set_goal', { objective: 'Ship the tool rows' })
  yield done('goal', '{"ok":true}')
  yield use('search', 'mcp__ramu__tool_invoke', { name: 'memory_search', arguments: { query: 'editor preferences' } })
  yield done('search', '[]')
  yield use('save', 'mcp__ramu__tool_invoke', {
    name: 'memory_save',
    arguments: {
      kind: 'user',
      title: 'Prefers tabs over spaces',
      content: 'Use tabs in every project.',
      scope: 'global',
    },
  })
  yield done('save', '{"action":"created","memory":{"id":"m1","title":"Prefers tabs over spaces"}}')
  yield use('skill', 'mcp__ramu__skill_inspect', { id: 'skill-1' })
  yield done('skill', '{"id":"skill-1","name":"Release checklist"}')
  yield use('ask', 'mcp__ramu__ask_user', { questions: [] })
  yield done('ask', '{"requestId":"q1"}')
  yield use('ask-failed', 'mcp__ramu__ask_user', { questions: [] })
  yield done('ask-failed', 'Question could not be saved', true)
  yield use('lookup', 'mcp__ramu__tool_search', { query: 'schedule' })
  yield done('lookup', '[]')
  for (const n of [1, 2, 3, 4]) {
    const call = `team-call-${stamp}-${n}`,
      task = `team-task-${stamp}-${n}`
    yield msg({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_use',
            id: call,
            name: 'Agent',
            input: {
              description: `Review package ${n}`,
              prompt: `Look through package ${n}`,
              subagent_type: 'Explore',
              name: `reviewer-${n}`,
              run_in_background: true,
            },
          },
        ],
      },
    })
    yield msg({
      type: 'system',
      subtype: 'task_started',
      task_id: task,
      tool_use_id: call,
      description: `Review package ${n}`,
      subagent_type: 'Explore',
      task_type: 'local_agent',
      is_backgrounded: true,
      prompt: `Look through package ${n}`,
    })
    if (n < 3)
      yield msg({
        type: 'system',
        subtype: 'task_notification',
        task_id: task,
        tool_use_id: call,
        status: 'completed',
        output_file: '',
        summary: `Package ${n} looks fine.`,
        usage: { total_tokens: 2100, tool_uses: 3, duration_ms: 4200 },
      })
  }
  yield msg({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'Tool rows are in place.' }] },
  })
  yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 })
}

export const fakeQuery: QueryFn = ({ prompt, options }) => {
  const stopped = new Set<string>()
  async function* run(): AsyncGenerator<SDKMessage, void> {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: `fake-${Date.now()}`,
      model: 'fake-agent',
      cwd: options.cwd,
    } as unknown as SDKMessage
    for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
      // Messages with attachments arrive as content blocks; their text blocks are the prompt.
      const text =
        typeof m.message.content === 'string'
          ? m.message.content
          : m.message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
      if (options.forkSession) {
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'text', text: `Fork answer: ${text.match(/<question>\n([\s\S]*?)\n<\/question>/)?.[1] ?? text}` },
            ],
          },
        })
        yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 })
        continue
      }
      if (text.includes('[limit claude]')) {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'usage limit reached',
          total_cost_usd: 0,
        } as unknown as SDKMessage
        continue
      }
      // [usage 92] reports Claude plan usage: 92% of the 5-hour window and a third of that weekly.
      const usage = /\[usage (\d+)\]/.exec(text)
      if (usage) {
        const used = Number(usage[1]) / 100,
          now = Math.floor(Date.now() / 1000)
        // The shape the real SDK sends: every window in unifiedWindows.
        yield msg({
          type: 'rate_limit_event',
          rate_limit_info: {
            status: used >= 1 ? 'rejected' : used >= 0.8 ? 'allowed_warning' : 'allowed',
            rateLimitType: 'five_hour',
            resetsAt: now + 2 * 3600 + 840,
            unifiedWindows: {
              five_hour: { utilization: used, resetsAt: now + 2 * 3600 + 840 },
              seven_day: { utilization: used / 3, resetsAt: now + 4 * 86400 },
            },
          },
        })
      }
      if (text.includes('[slow]')) {
        // A long main turn, so the chat stays working (RAMU_FAKE_AGENT_DELAY ms).
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'Reading the codebase before making changes.' }] },
        })
        // With [questions …] it asks mid-turn and keeps working.
        const server = options.mcpServers?.ramu
        if (server && 'url' in server && 'headers' in server)
          await fakeTools(text, {
            url: server.url,
            token: server.headers?.Authorization?.replace(/^Bearer /, '') ?? '',
          })
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [{ type: 'tool_use', id: `slow-${Date.now()}`, name: 'Bash', input: { command: 'pnpm test' } }],
          },
        })
        await sleep(Number(process.env.RAMU_FAKE_AGENT_DELAY ?? 2500))
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'Done reading.' }] },
        })
        yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 })
        continue
      }
      if (text.includes('[ramu tools]')) {
        yield* ramuToolsTurn()
        continue
      }
      if (text.includes('[agents]')) {
        yield* agentsTurn(stopped, Number(process.env.RAMU_FAKE_AGENT_DELAY ?? 2500))
        continue
      }
      const relay = /^Message for the agent "(.+?)" \((.+?)\)\.[^\n]*\n\n([\s\S]*)$/.exec(text)
      if (relay) {
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: 'tool_use',
                id: `relay-${Date.now()}`,
                name: 'SendMessage',
                input: { to: relay[2], message: relay[3] },
              },
            ],
          },
        })
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: `Passed your message to ${relay[1]}.` }] },
        })
        yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 })
        continue
      }
      if (text.includes('[tool progress]')) {
        const ids = [1, 2, 3].map((n) => `progress-${Date.now()}-${n}`)
        for (const [index, id] of ids.entries())
          yield msg({
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
              content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `echo command-${index + 1}` } }],
            },
          })
        for (const id of ids.slice(0, 2))
          yield msg({
            type: 'user',
            parent_tool_use_id: null,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] },
          })
        await sleep(2500)
        yield msg({
          type: 'user',
          parent_tool_use_id: null,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: ids[2], content: 'done' }] },
        })
        yield msg({
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [{ type: 'text', text: 'All commands finished.' }] },
        })
        yield msg({ type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0 })
        continue
      }
      if (text.includes('[rich]')) {
        yield* demoTurn(RICH_REPLY)
        continue
      }
      if (text.includes('[demo]') || process.env.RAMU_FAKE_DEMO === '1') {
        yield* demoTurn()
        continue
      }
      const input = { command: 'pwd' }
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_use', id: 'fake-tool', name: 'Bash', input }] },
      } as unknown as SDKMessage
      // Like the real adapter, automatic mode decides without asking; other modes defer to the user.
      const res =
        options.permissionMode === 'auto'
          ? { behavior: 'allow' as const }
          : await options.canUseTool!('Bash', input, {
              signal: options.abortController!.signal,
              toolUseID: 'fake-tool',
            } as never)
      const server = options.mcpServers?.ramu
      if (server && 'url' in server && 'headers' in server)
        await fakeTools(text, { url: server.url, token: server.headers?.Authorization?.replace(/^Bearer /, '') ?? '' })
      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'fake-tool',
              content: res?.behavior === 'allow' ? options.cwd : 'denied',
            },
          ],
        },
      } as unknown as SDKMessage
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: `Fake agent in ${options.cwd} received: ${text}` }] },
      } as unknown as SDKMessage
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        total_cost_usd: 0,
      } as unknown as SDKMessage
    }
  }
  // The context fills with each message, so the meter has something to show.
  let messages = 0
  return Object.assign(run(), {
    interrupt: async () => undefined,
    backgroundTasks: async () => true,
    getContextUsage: async () => ({ totalTokens: 12_000 + (messages += 1) * 9_000, maxTokens: 200_000, percentage: 0 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
      subscription_type: 'max',
      rate_limits: null,
    }),
    stopTask: async (taskId: string) => {
      stopped.add(taskId)
    },
  }) as unknown as Query
}

/** Test-only Codex adapter; no account or model usage. */
export const fakeCodex: import('../agent/agentRunner').AgentRunnerFactory = (scope, settings, emit) => {
  let connection: McpConnection | undefined
  let stopped = false
  let resolvePermission: (() => void) | null = null
  let resolveElicitation: (() => void) | null = null
  let elicitation: AgentElicitation | null = null
  const send = async (prompt: string) => {
    emit({ kind: 'state', state: 'running' })
    if (prompt.includes('[limit codex]')) {
      emit({ kind: 'result', isError: true, text: 'usageLimitExceeded', costUsd: null }, true)
      return
    }
    if (prompt.includes('[compaction]')) {
      const compactionId = randomUUID()
      const before = { beforeTokens: 212000, contextWindow: 258400 }
      emit({ kind: 'context', used: 212000, max: 258400 })
      emit({
        kind: 'tool-use',
        toolUseId: 'before-compaction',
        name: 'Bash',
        summary: 'pwd',
        input: '{"command":"pwd"}',
      })
      emit({ kind: 'tool-result', toolUseId: 'before-compaction', summary: 'workspace', isError: false })
      emit({ kind: 'compaction', state: 'started', compactionId, ...before })
      await sleep(3000)
      if (stopped) return
      emit({ kind: 'compaction', state: 'completed', compactionId, ...before })
      emit({ kind: 'context', used: 33700, max: 258400 })
      emit({ kind: 'compaction', state: 'completed', compactionId, ...before, afterTokens: 33700 })
      emit({ kind: 'text', text: 'Continued after compaction.' })
      emit({ kind: 'result', isError: false, text: 'done', costUsd: null })
      return
    }
    const fill = /\[context (\d+)\]/.exec(prompt)
    if (fill) emit({ kind: 'context', used: Number(fill[1]) * 1000, max: 400_000 })
    const used = /\[codex-usage (\d+)\]/.exec(prompt)
    if (used)
      emit({
        kind: 'usage',
        readings: [
          {
            provider: 'codex',
            window: 'five_hour',
            usedPercent: Number(used[1]),
            status: Number(used[1]) >= 100 ? 'limited' : 'ok',
            resetsAt: Date.now() + 3 * 3600_000,
            updatedAt: Date.now(),
          },
          {
            provider: 'codex',
            window: 'weekly',
            usedPercent: Math.round(Number(used[1]) / 2),
            status: 'ok',
            resetsAt: Date.now() + 3 * 86_400_000,
            updatedAt: Date.now(),
          },
        ],
      })
    if (prompt.includes('[mcp form]') || prompt.includes('[mcp url]')) {
      elicitation = elicitationRequest(`fake-mcp-${randomUUID()}`, {
        serverName: 'Demo connector',
        message: prompt.includes('[mcp url]') ? 'Connect your account' : 'Configure your workspace',
        ...(prompt.includes('[mcp url]')
          ? { mode: 'url', url: 'https://example.com/connect', elicitationId: 'demo' }
          : {
              mode: 'form',
              requestedSchema: {
                type: 'object',
                properties: {
                  count: { type: 'integer', title: 'Worker count', minimum: 1, maximum: 5 },
                  enabled: { type: 'boolean', title: 'Enable caching' },
                  region: {
                    type: 'string',
                    title: 'Region',
                    oneOf: [
                      { const: 'id', title: 'Jakarta' },
                      { const: 'sg', title: 'Singapore' },
                    ],
                  },
                  note: { type: 'string', title: 'Note' },
                },
                required: ['count', 'enabled', 'region'],
              },
            }),
      })
      await new Promise<void>((resolve) => {
        resolveElicitation = resolve
        emit({ kind: 'elicitation', ...elicitation! })
        emit({ kind: 'state', state: 'needs-input' })
      })
      if (!stopped) emit({ kind: 'result', isError: false, text: 'done', costUsd: null })
      return
    }
    emit({ kind: 'tool-use', toolUseId: 'fake-codex-tool', name: 'Bash', summary: 'pwd' })
    if (prompt.includes('[live codex tools]')) {
      emit({
        kind: 'tool-result',
        toolUseId: 'fake-codex-tool',
        isError: false,
        summary: 'First output line',
        running: true,
      })
      emit({
        kind: 'tool-result',
        toolUseId: 'fake-codex-tool',
        isError: false,
        summary: 'First output line\nSecond output line',
        running: true,
      })
      emit({ kind: 'turn-diff', turnId: 'fake-codex-live-turn', diff: 'Old provisional patch' })
      emit({
        kind: 'turn-diff',
        turnId: 'fake-codex-live-turn',
        diff: '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+updated',
      })
    }
    if (settings.access !== 'full')
      await new Promise<void>((resolve) => {
        resolvePermission = resolve
        emit({
          kind: 'permission-request',
          requestId: 'fake-codex-permission',
          toolName: 'Bash',
          title: 'Allow command?',
          detail: 'pwd',
          approvalKey: permissionKey('Bash', { command: 'pwd' }),
        })
        emit({ kind: 'state', state: 'needs-input' })
      })
    if (stopped) return
    await fakeTools(prompt, connection)
    emit({ kind: 'tool-result', toolUseId: 'fake-codex-tool', isError: false, summary: scope.cwd })
    emit({ kind: 'text', text: `Fake Codex in ${scope.cwd} received: ${prompt}` })
    emit({ kind: 'result', isError: false, text: 'done', costUsd: null })
  }
  return {
    setTools: (tools) => {
      connection = tools
    },
    start: async (prompt, resume) => {
      emit({
        kind: 'init',
        model: settings.model || 'fake-codex',
        cwd: scope.cwd,
        providerSessionId: resume || 'fake-codex-thread',
      })
      void send(prompt)
    },
    send: async (prompt) => {
      void send(prompt)
    },
    steer: async (text) => {
      emit({ kind: 'text', text: `Steered: ${text}` })
    },
    interrupt: async () => {
      emit({ kind: 'result', isError: false, text: 'interrupted', costUsd: null })
    },
    stop: async () => {
      stopped = true
      resolvePermission?.()
      if (elicitation) emit({ kind: 'request-resolved', requestId: elicitation.requestId, outcome: 'cancelled' })
      elicitation = null
      resolveElicitation?.()
    },
    replyElicitation: (requestId: string, action: ElicitationAction, answers: Record<string, string>) => {
      if (!elicitation || elicitation.requestId !== requestId)
        throw new Error('That input request is no longer pending.')
      const content = action === 'accept' ? elicitationContent(elicitation, answers) : null
      emit({
        kind: 'request-resolved',
        requestId,
        outcome: action === 'accept' ? 'answered' : action === 'decline' ? 'declined' : 'cancelled',
      })
      emit({ kind: 'text', text: `Connector response: ${action} ${JSON.stringify(content)}` })
      emit({ kind: 'state', state: 'running' })
      elicitation = null
      resolveElicitation?.()
    },
    replyPermission: (requestId, allow) => {
      emit({ kind: 'request-resolved', requestId, outcome: allow ? 'allowed' : 'denied' })
      resolvePermission?.()
    },
    replyQuestion: () => {},
  }
}
