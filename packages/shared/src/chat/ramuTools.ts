import type { AgentEvent } from '../types'

type ToolUse = Extract<AgentEvent, { kind: 'tool-use' }>
type CallSource = Pick<ToolUse, 'name' | 'summary'> & { input?: string }
export type RamuToolCall = { name: string; args: Record<string, unknown> }
export type RamuToolIcon =
  'brain' | 'book' | 'search' | 'sparkles' | 'calendar' | 'message' | 'review' | 'terminal' | 'wrench'
export type RamuToolRow = {
  icon: RamuToolIcon
  done: string
  running: string
  subject?: string
  facts: { label: string; value: string }[]
}

const KNOWN = new Set([
  'ask_user',
  'question_status',
  'wait_for_answer',
  'close_question',
  'advisor',
  'wait_for_advice',
  'set_goal',
  'get_goal',
  'update_goal',
  'tool_search',
  'tool_invoke',
  'tool_result_read', // removed with compression; kept so old transcripts still read well
  'memory_search',
  'memory_read',
  'memory_save',
  'memory_update',
  'memory_forget',
  'memory_archive',
  'memory_restore',
  'memory_merge',
  'skill_inspect',
  'skill_find',
  'skill_install',
  'skill_list',
  'skill_update_from_source',
  'skill_remove',
  'skill_disable',
  'skill_move',
  'watch_pull_request',
  'unwatch_pull_request',
  'skill_update',
  'skill_archive',
  'skill_restore',
  // No provider is given these anymore; they stay so transcripts recorded earlier still render.
  'skill_search',
  'skill_read',
  'session_recall',
  'session_search',
  'skill_resolve',
  'review_reply',
  'review_add_note',
  'schedule_create',
  'schedule_update',
  'schedule_list',
  'schedule_pause',
  'schedule_run_now',
  'schedule_delete',
  'schedule_context',
  'ramu_agent',
  'message_parent',
  'ask_parent',
  'answer_subagent',
  'teammate_message',
  'teammate_ask',
  'teammate_suggest',
  'rtk_run',
  'background_terminal_launch',
  'background_terminal_list',
  'background_terminal_inspect',
  'background_terminal_wait',
  'background_terminal_stop',
  'codex_pre_tool_use',
])

/** Calls whose result Ramu already draws somewhere else in the chat: a card, the question dock, the goal tray. */
const OWN_UI = new Set([
  'ask_user',
  'question_status',
  'wait_for_answer',
  'close_question',
  'advisor',
  'wait_for_advice',
  'set_goal',
  'get_goal',
  'update_goal',
  'schedule_create',
  'schedule_update',
  'ramu_agent',
  'codex_pre_tool_use',
])

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const parse = (text: string | undefined): unknown => {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
const clip = (value: string, n = 80) => {
  const one = value.replace(/\s+/g, ' ')
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
const quote = (value: string | undefined) => (value ? `“${clip(value)}”` : undefined)

/** Which Ramu tool a call is, however the provider names it: Claude's `mcp__ramu__x`, Codex's `x` on the `ramu` server, OpenCode's `ramu_x`. */
export function ramuTool(tool: CallSource): RamuToolCall | null {
  const claude = /^mcp__ramu__(.+)$/.exec(tool.name)?.[1]
  const opencode = /^ramu_(.+)$/.exec(tool.name)?.[1]
  const name =
    claude ??
    (opencode && KNOWN.has(opencode) ? opencode : undefined) ??
    (tool.summary === 'ramu' ? tool.name : undefined)
  if (!name || !KNOWN.has(name)) return null
  const args = record(parse(tool.input) ?? (tool.summary.startsWith('{') ? parse(tool.summary) : undefined))
  // Most calls arrive through the deferred catalog as tool_invoke { name, arguments }.
  if (name === 'tool_invoke') {
    const inner = text(args.name)
    return inner && KNOWN.has(inner) && inner !== 'tool_invoke'
      ? { name: inner, args: record(args.arguments) }
      : { name, args }
  }
  return { name, args }
}

/** True when the call is Ramu's own and its outcome already has a place in the chat. */
export const ramuToolHasOwnUi = (tool: CallSource): boolean => {
  const call = ramuTool(tool)
  return !!call && OWN_UI.has(call.name)
}

const outcome = (result: string | undefined) => record(parse(result))

/** Shown on a review chat's tool row when it changed a memory or skill that is normally protected. */
const PROTECTED_AT_YOUR_REQUEST = 'Protected item changed at your request'

/** What a Ramu tool call reads as in the transcript: a verb, its subject and the few facts worth showing, never the raw JSON. */
export function describeRamuTool(call: RamuToolCall, result?: string): RamuToolRow {
  const { args } = call
  const data = outcome(result)
  const query = text(args.query)
  const reply = (
    done: string,
    running: string,
    icon: RamuToolIcon,
    subject?: string,
    facts: RamuToolRow['facts'] = [],
  ): RamuToolRow => ({
    icon,
    done,
    running,
    ...(subject ? { subject } : {}),
    // A review chat edit to something protected says so, with the words the user asked in.
    facts: [
      ...(data.protectedChange === true
        ? [
            { label: 'Protected', value: PROTECTED_AT_YOUR_REQUEST },
            { label: 'You asked', value: quote(text(data.userRequest)) ?? '' },
          ]
        : []),
      ...facts,
    ].filter((fact) => fact.value),
  })
  const memory = record(data.memory)
  switch (call.name) {
    case 'memory_search':
      return reply('Searched memory', 'Searching memory', 'brain', quote(query), [
        { label: 'Kind', value: text(args.kind) ?? '' },
      ])
    case 'memory_read':
      return reply('Read memory', 'Reading memory', 'brain', quote(text(data.title)))
    case 'memory_save':
      return reply('Saved memory', 'Saving memory', 'brain', quote(text(args.title) ?? text(memory.title)), [
        { label: 'Kind', value: text(args.kind) ?? '' },
        { label: 'Scope', value: text(args.scope) ?? '' },
        { label: 'Content', value: text(args.content) ?? '' },
      ])
    case 'memory_update':
      return reply('Updated memory', 'Updating memory', 'brain', quote(text(args.title) ?? text(data.title)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'memory_forget':
      return reply('Forgot a memory', 'Forgetting a memory', 'brain', undefined, [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'memory_archive':
      return reply('Archived a memory', 'Archiving a memory', 'brain', quote(text(data.title)), [
        { label: 'Why', value: text(args.reason) ?? '' },
        { label: 'Restore', value: 'Restorable from the Memory page' },
      ])
    case 'memory_restore':
      return reply('Restored a memory', 'Restoring a memory', 'brain', quote(text(data.title)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'memory_merge': {
      const ids = Array.isArray(args.ids) ? args.ids.length : 0
      return reply('Merged memories', 'Merging memories', 'brain', quote(text(args.title)), [
        { label: 'Merged', value: ids ? `${ids} notes into one` : '' },
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    }
    case 'skill_inspect':
      return reply('Read skill', 'Reading skill', 'sparkles', quote(text(data.name)))
    case 'skill_find':
      return reply('Searched skills', 'Searching skills', 'search', quote(text(args.query)))
    case 'watch_pull_request':
      return reply('Watching pull request', 'Starting pull request watch', 'review', text(data.url) ?? text(args.url))
    case 'unwatch_pull_request':
      return reply('Stopped pull request watches', 'Stopping pull request watches', 'review')
    case 'skill_install':
      return reply(
        data.cancelled ? 'Cancelled skill installation' : 'Installed skill',
        'Preparing skill installation',
        'sparkles',
        quote(text(data.name) ?? text(args.source)),
      )
    case 'skill_list':
      return reply('Listed installed skills', 'Listing installed skills', 'sparkles')
    case 'skill_update_from_source':
      return reply(
        data.cancelled ? 'Cancelled skill update' : 'Updated skill from source',
        'Checking skill source',
        'sparkles',
        quote(text(data.name)),
      )
    case 'skill_remove':
      return reply(data.removed ? 'Removed skill' : 'Kept skill', 'Removing skill', 'sparkles')
    case 'skill_disable':
      return reply(
        args.disabled ? 'Disabled skill' : 'Enabled skill',
        args.disabled ? 'Disabling skill' : 'Enabling skill',
        'sparkles',
      )
    case 'skill_move':
      return reply(data.moved ? 'Moved skill' : 'Kept skill scope', 'Moving skill', 'sparkles')
    case 'skill_update':
      return reply('Updated skill', 'Updating skill', 'sparkles', quote(text(data.name) ?? text(args.name)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'skill_archive':
      return reply('Archived skill', 'Archiving skill', 'sparkles', quote(text(data.name)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'skill_restore':
      return reply('Restored skill', 'Restoring skill', 'sparkles', quote(text(data.name)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'skill_search':
      return reply('Searched skills', 'Searching skills', 'sparkles', quote(query))
    case 'skill_read':
      return reply('Read skill', 'Reading skill', 'sparkles', quote(text(data.name)))
    case 'session_search':
      return reply('Searched previous threads', 'Searching previous threads', 'search', quote(text(args.query)))
    case 'skill_resolve':
      return reply('Selected compatible skills', 'Selecting compatible skills', 'sparkles')
    case 'session_recall':
      return reply('Recalled earlier messages', 'Recalling earlier messages', 'book')
    case 'review_reply':
      return reply('Replied in review', 'Replying in review', 'review', undefined, [
        { label: 'Reply', value: text(args.body) ?? text(args.text) ?? text(args.message) ?? '' },
      ])
    case 'review_add_note':
      return reply('Added a review note', 'Adding a review note', 'review', undefined, [
        { label: 'Note', value: text(args.body) ?? text(args.text) ?? text(args.note) ?? '' },
      ])
    case 'schedule_list':
      return reply('Listed schedules', 'Listing schedules', 'calendar')
    case 'schedule_pause':
      return args.paused === false
        ? reply('Resumed a schedule', 'Resuming a schedule', 'calendar')
        : reply('Paused a schedule', 'Pausing a schedule', 'calendar')
    case 'schedule_run_now':
      return reply('Ran a schedule', 'Running a schedule', 'calendar')
    case 'schedule_delete':
      return reply('Deleted a schedule', 'Deleting a schedule', 'calendar')
    case 'schedule_context':
      return reply('Checked schedule options', 'Checking schedule options', 'calendar')
    case 'tool_search':
      return reply('Looked up Ramu tools', 'Looking up Ramu tools', 'search', quote(query))
    case 'tool_result_read':
      return reply('Read saved output', 'Reading saved output', 'book')
    case 'message_parent':
      return reply('Messaged the main agent', 'Messaging the main agent', 'message', undefined, [
        { label: 'Message', value: text(args.text) ?? '' },
      ])
    case 'ask_parent':
      return reply('Asked the main agent', 'Asking the main agent', 'message', undefined, [
        { label: 'Question', value: text(args.question) ?? '' },
      ])
    case 'answer_subagent':
      return reply('Answered a sub-agent', 'Answering a sub-agent', 'message', undefined, [
        { label: 'Answer', value: text(args.text) ?? '' },
      ])
    case 'teammate_message': {
      const facts = [{ label: 'Message', value: text(args.text) ?? '' }]
      return text(args.to)?.toLowerCase() === 'lead'
        ? reply('Messaged the main agent', 'Messaging the main agent', 'message', undefined, facts)
        : reply('Messaged teammate', 'Messaging teammate', 'message', text(args.to), facts)
    }
    case 'teammate_suggest':
      return reply('Suggested a teammate', 'Suggesting a teammate', 'message', text(args.model), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    case 'teammate_ask':
      // The reply comes back inside the lead's turn, so this row is the only place the person can read it.
      return reply('Asked teammate', 'Asking teammate', 'message', text(args.to), [
        { label: 'Question', value: text(args.question) ?? '' },
        { label: 'Reply', value: text(data.reply) ?? '' },
      ])
    case 'ask_user':
      return reply('Asked a question', 'Asking a question', 'message')
    case 'question_status':
      return reply('Checked a question', 'Checking a question', 'message')
    case 'wait_for_answer':
      return reply('Waited for an answer', 'Waiting for an answer', 'message')
    case 'close_question':
      return reply('Closed a question', 'Closing a question', 'message')
    case 'set_goal':
      return reply('Set a goal', 'Setting a goal', 'sparkles')
    case 'get_goal':
      return reply('Checked the goal', 'Checking the goal', 'sparkles')
    case 'update_goal':
      return reply('Updated the goal', 'Updating the goal', 'sparkles')
    case 'schedule_create':
      return reply('Created a schedule', 'Creating a schedule', 'calendar')
    case 'schedule_update':
      return reply('Updated a schedule', 'Updating a schedule', 'calendar')
    case 'ramu_agent':
      return reply('Started an agent', 'Starting an agent', 'message')
    case 'advisor':
      return reply('Asked the advisor', 'Asking the advisor', 'message')
    case 'wait_for_advice':
      return reply('Waited for advice', 'Waiting for advice', 'message')
    case 'rtk_run':
      return reply(
        'Ran',
        'Running',
        'terminal',
        Array.isArray(args.arguments) ? clip(`rtk ${args.arguments.map(String).join(' ')}`) : undefined,
      )
    case 'background_terminal_launch':
      return reply('Started in the background', 'Starting in the background', 'terminal', command(args.command))
    case 'background_terminal_list':
      return reply('Listed background commands', 'Listing background commands', 'terminal')
    case 'background_terminal_inspect':
      return reply('Checked a background command', 'Checking a background command', 'terminal', command(data.command))
    case 'background_terminal_stop':
      return reply('Stopped a background command', 'Stopping a background command', 'terminal', command(data.command))
    case 'background_terminal_wait':
      return describeWait(args, data, reply)
    default:
      return reply('Used', 'Using', 'wrench', call.name.replace(/_/g, ' '))
  }
}

const command = (value: unknown) => {
  const line = text(value)
  return line ? clip(line, 60) : undefined
}

const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`)

/** A wait reads as what came of it: the text it saw, how the command ended, or that it stopped waiting. */
function describeWait(
  args: Record<string, unknown>,
  data: Record<string, unknown>,
  reply: (
    done: string,
    running: string,
    icon: RamuToolIcon,
    subject?: string,
    facts?: RamuToolRow['facts'],
  ) => RamuToolRow,
): RamuToolRow {
  const expected = Array.isArray(args.outputIncludes) ? args.outputIncludes.map(String).filter(Boolean) : []
  const commands = Array.isArray(data.commands) ? data.commands.map(record) : []
  const failed = commands.find((entry) => entry.state === 'failed')
  const first = failed ?? commands[0]
  const subject =
    commands.length > 1 ? commands.map((entry) => command(entry.command)).join(', ') : command(first?.command)
  const waited = typeof data.waitedMs === 'number' ? seconds(data.waitedMs) : ''
  const matched = record(data.matched)
  const exit = typeof first?.exitCode === 'number' ? String(first.exitCode) : ''
  const running = expected.length ? 'Waiting for output' : 'Waiting for a background command'
  const facts = [
    { label: 'Waiting for', value: expected.map((entry) => `“${clip(entry, 40)}”`).join(', ') },
    { label: 'Waited', value: waited },
  ]
  switch (data.reason) {
    case 'matched':
      return reply('Saw', running, 'terminal', quote(text(matched.text)), [
        { label: 'Command', value: subject ?? '' },
        ...facts.slice(1),
      ])
    case 'exited':
      return failed
        ? reply('Background command failed', running, 'terminal', subject, [
            ...facts,
            { label: 'Exit code', value: exit },
          ])
        : reply('Background command finished', running, 'terminal', subject, [
            ...facts,
            { label: 'Exit code', value: exit },
          ])
    case 'quiet':
      return reply('Background command went quiet', running, 'terminal', subject, facts)
    case 'timeout':
      return reply('Stopped waiting', running, 'terminal', subject, facts)
    default:
      return reply('Waited for a background command', running, 'terminal', undefined, facts.slice(0, 1))
  }
}

type AgentStatus = 'running' | 'completed' | 'failed' | 'stopped'

/** Counts of agent states as a line: "2 running · 1 done". */
export function summarizeAgentStatuses(
  statuses: readonly AgentStatus[],
  label: (status: AgentStatus) => string = (status) => (status === 'completed' ? 'done' : status),
): string {
  return (['running', 'failed', 'stopped', 'completed'] as const)
    .flatMap((status) => {
      const n = statuses.filter((value) => value === status).length
      return n ? [`${n} ${label(status)}`] : []
    })
    .join(' · ')
}
