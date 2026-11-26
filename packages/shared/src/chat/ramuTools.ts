import type { AgentEvent } from '../types'
import { ABILITY_TOOLS } from '@ramu/shared/providers/abilities'

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
  'request_secret',
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
  'ci_setup',
  'ship',
  'skill_update',
  'skill_archive',
  'skill_restore',
  'session_recall',
  'session_search',
  'review_reply',
  'change_review_reply',
  'schedule_create',
  'schedule_update',
  'schedule_list',
  'schedule_pause',
  'schedule_run_now',
  'schedule_delete',
  'schedule_context',
  'ramu_agent',
  'ramu_agent_status',
  'ramu_agent_stop',
  'agent_models',
  'generate_image',
  'edit_image',
  'web_search',
  'read_long',
  'message_parent',
  'ask_parent',
  'answer_subagent',
  'background_terminal_launch',
  'background_terminal_list',
  'background_terminal_inspect',
  'background_terminal_wait',
  'background_terminal_stop',
  'background_wait',
  'terminal_list',
  'terminal_read',
  'codex_pre_tool_use',
  'artifact_preview',
  'artifact_publish',
  'artifact_read',
  'artifact_versions',
  'artifact_list',
  'artifact_get',
  'artifact_records',
  'artifact_published',
  'artifact_run',
  'run_script',
  'browser_cancel_download',
  'browser_click',
  'browser_close',
  'browser_diagnostics',
  'browser_dialog_status',
  'browser_downloads',
  'browser_drag',
  'browser_handle_dialog',
  'browser_hover',
  'browser_list',
  'browser_navigate',
  'browser_open',
  'browser_prepare_download',
  'browser_present',
  'browser_press',
  'browser_profiles',
  'browser_request_access',
  'browser_resize',
  'browser_save_download',
  'browser_screenshot',
  'browser_scroll',
  'browser_select',
  'browser_set_appearance',
  'browser_snapshot',
  'browser_status',
  'browser_type',
  'browser_upload',
  'browser_wait',
  'computer_click',
  'computer_close',
  'computer_drag',
  'computer_key',
  'computer_observe',
  'computer_open',
  'computer_scroll',
  'computer_status',
  'computer_type',
  'draft_review',
  'platform_cli',
  'plugin_create',
  'plugin_install',
  'plugin_search',
  'tool_suggest',
  'project_add',
  'project_create',
  'project_list',
  'propose_theme',
  'pull_request_comment',
  'pull_request_delete_comment',
  'pull_request_edit_comment',
  'pull_request_line_comment',
  'pull_request_list',
  'pull_request_merge',
  'pull_request_react',
  'pull_request_reply',
  'pull_request_rerun_checks',
  'pull_request_resolve',
  'pull_request_review',
  'pull_request_reviewers',
  'pull_request_state',
  'pull_request_threads',
  'pull_request_update',
  'pull_request_view',
  'pull_request_withdraw_review',
  'review_drafts',
  'settings_change',
  'settings_find',
  'show_ui',
  'status',
  'test_device_install',
  'test_device_launch',
  'test_device_list',
  'test_device_logs',
  'test_device_open',
  'test_device_open_link',
  'test_device_rotate',
  'test_device_stop',
  'thread_continue_in_worktree',
  'thread_message',
  'thread_start',
  'thread_status',
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
  // The card itself shows what the call drew.
  'show_ui',
  'schedule_create',
  'schedule_update',
  'ramu_agent',
  'codex_pre_tool_use',
  // Ability calls record their own row, refusals and failures included.
  'generate_image',
  'edit_image',
  'web_search',
  'read_long',
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

/**
 * The bare tool in an OpenCode name: `ramu_<tool>` for the tools it lists directly, `ramu_tools_<tool>` for the rest,
 * reached through its execute tool.
 */
export const openCodeRamuName = (name: string): string | undefined => /^ramu_(?:tools_)?(.+)$/.exec(name)?.[1]

/**
 * Which Ramu tool a call is, however the provider names it: Claude's `mcp__ramu__x`, Codex's `x` on the `ramu` server,
 * OpenCode's `ramu_x`, Antigravity's `mcp_ramu_x`.
 */
export function ramuTool(tool: CallSource): RamuToolCall | null {
  const claude = /^mcp__ramu__(.+)$/.exec(tool.name)?.[1]
  const opencode = openCodeRamuName(tool.name)
  const antigravity = /^mcp_ramu_(.+)$/.exec(tool.name)?.[1]
  const name =
    claude ??
    (opencode && KNOWN.has(opencode) ? opencode : undefined) ??
    (antigravity && KNOWN.has(antigravity) ? antigravity : undefined) ??
    (tool.summary === 'ramu' ? tool.name : undefined)
  if (!name || !KNOWN.has(name)) return null
  const args = record(parse(tool.input) ?? (tool.summary.startsWith('{') ? parse(tool.summary) : undefined))
  // Most calls arrive through the deferred catalog as tool_invoke { name, arguments }.
  if (name === 'tool_invoke') {
    const inner = text(args.name)
    // Every tool in the catalog is Ramu's, so the call reads as the tool it ran even before this list names it.
    return inner && inner !== 'tool_invoke' ? { name: inner, args: record(args.arguments) } : { name, args }
  }
  return { name, args }
}

/** An ability call: its `ability` row stands for it, refusals and failures included. */
export const isAbilityToolCall = (tool: CallSource): boolean => {
  const name = ramuTool(tool)?.name
  return !!name && Object.hasOwn(ABILITY_TOOLS, name)
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
    case 'tool_suggest': {
      const tool = args.tool && typeof args.tool === 'object' ? (args.tool as Record<string, unknown>) : {}
      return reply('Suggested a tool', 'Suggesting a tool', 'sparkles', quote(text(tool.name)), [
        { label: 'Why', value: text(args.reason) ?? '' },
      ])
    }
    case 'pull_request_list':
      return reply('Listed pull requests', 'Listing pull requests', 'review')
    case 'pull_request_view':
      return reply('Read pull request', 'Reading pull request', 'review', text(args.pullRequest))
    case 'pull_request_threads':
      return reply('Read review threads', 'Reading review threads', 'review', text(args.pullRequest))
    case 'pull_request_comment':
      return reply('Commented on pull request', 'Commenting on pull request', 'review', quote(text(args.body)))
    case 'pull_request_reply':
      return reply('Replied on pull request', 'Replying on pull request', 'review', quote(text(args.body)))
    case 'pull_request_line_comment':
      return reply('Commented on a line', 'Commenting on a line', 'review', quote(text(args.body)))
    case 'pull_request_edit_comment':
      return reply('Edited a comment', 'Editing a comment', 'review', quote(text(args.body)))
    case 'pull_request_delete_comment':
      return reply('Deleted a comment', 'Deleting a comment', 'review')
    case 'pull_request_react':
      return reply('Reacted to a comment', 'Reacting to a comment', 'review')
    case 'pull_request_resolve':
      return reply('Resolved review thread', 'Resolving review thread', 'review')
    case 'pull_request_review':
      return reply('Reviewed pull request', 'Reviewing pull request', 'review', quote(text(args.body)))
    case 'pull_request_withdraw_review':
      return reply('Withdrew review', 'Withdrawing review', 'review')
    case 'pull_request_reviewers':
      return reply('Changed reviewers', 'Changing reviewers', 'review')
    case 'pull_request_update':
      return reply('Updated pull request', 'Updating pull request', 'review')
    case 'pull_request_merge':
      return reply('Asked to merge pull request', 'Asking to merge pull request', 'review')
    case 'pull_request_state':
      return reply('Asked to change pull request state', 'Asking to change pull request state', 'review')
    case 'pull_request_rerun_checks':
      return reply('Reran failed checks', 'Rerunning failed checks', 'review')
    case 'review_drafts':
      return reply('Read review drafts', 'Reading review drafts', 'review')
    case 'draft_review':
      return reply('Drafted a review', 'Drafting a review', 'review', quote(text(args.body)))
    case 'watch_pull_request':
      return reply('Watching pull request', 'Starting pull request watch', 'review', text(data.url) ?? text(args.url))
    case 'unwatch_pull_request':
      return reply('Stopped pull request watches', 'Stopping pull request watches', 'review')
    case 'ship':
      return reply(
        data.shipping === false ? 'Stopped shipping' : data.rounds === 'reset' ? 'Allowed more rounds' : 'Shipping',
        'Starting to ship',
        'review',
      )
    case 'ci_setup':
      return reply(
        data.written === false ? 'Read the CI workflow' : 'Wrote the CI workflow',
        'Writing the CI workflow',
        'wrench',
        text(data.path),
      )
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
    case 'session_search':
      return reply('Searched previous threads', 'Searching previous threads', 'search', quote(text(args.query)))
    case 'session_recall':
      return reply('Recalled earlier messages', 'Recalling earlier messages', 'book')
    case 'review_reply':
    case 'change_review_reply':
      return reply('Replied in review', 'Replying in review', 'review', undefined, [
        { label: 'Reply', value: text(args.reply) ?? text(args.body) ?? text(args.text) ?? text(args.message) ?? '' },
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
    case 'ask_user':
      return reply('Asked a question', 'Asking a question', 'message')
    case 'request_secret':
      return reply('Asked for a secret', 'Asking for a secret', 'message', text(args.label))
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
    case 'ramu_agent_status':
      return reply('Checked helpers', 'Checking helpers', 'message')
    case 'ramu_agent_stop':
      return reply('Stopped a helper', 'Stopping a helper', 'message')
    case 'agent_models':
      return reply('Listed models', 'Listing models', 'search', quote(text(args.query)))
    case 'advisor':
      return reply('Asked the advisor', 'Asking the advisor', 'message')
    case 'wait_for_advice':
      return reply('Waited for advice', 'Waiting for advice', 'message')
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
    case 'background_wait': {
      const matched = Array.isArray(data.matched) ? data.matched.length : undefined
      if (matched === 0)
        return reply('Found no background command to wait on', 'Waiting on a background command', 'terminal')
      return args.waiting === false
        ? reply('Stopped waiting on a background command', 'Stopped waiting on a background command', 'terminal')
        : reply('Waiting on a background command', 'Waiting on a background command', 'terminal')
    }
    case 'terminal_list':
      return reply('Looked at your terminals', 'Looking at your terminals', 'terminal')
    case 'terminal_read':
      return reply('Read your terminal', 'Reading your terminal', 'terminal')
    case 'artifact_preview':
      return reply('Previewed an artifact', 'Previewing an artifact', 'sparkles', quote(text(args.title)))
    case 'artifact_publish':
      return reply('Published an artifact', 'Publishing an artifact', 'sparkles', quote(text(args.title)), [
        { label: 'Changes', value: text(args.changes) ?? '' },
      ])
    case 'artifact_read':
      return reply('Read an artifact', 'Reading an artifact', 'book', quote(text(record(data.reference).title)))
    case 'artifact_versions':
      return reply('Listed artifact versions', 'Listing artifact versions', 'book')
    case 'artifact_list':
      return reply('Listed artifacts', 'Listing artifacts', 'search')
    case 'artifact_get':
      return reply('Read an artifact', 'Reading an artifact', 'book', quote(text(record(data.artifact).title)))
    case 'artifact_records':
      return args.action === 'add'
        ? reply('Added a record', 'Adding a record', 'book', text(args.collection))
        : args.action === 'update'
          ? reply('Updated a record', 'Updating a record', 'book', text(args.collection))
          : reply('Read records', 'Reading records', 'book', text(args.collection))
    case 'artifact_published':
      return reply(
        'Recorded where an artifact is live',
        'Recording where an artifact is live',
        'wrench',
        text(args.url),
      )
    case 'artifact_run':
      return reply('Ran an artifact', 'Running an artifact', 'sparkles', text(args.run) ?? quote(text(args.task)))
    case 'run_script': {
      const made = Object.entries(record(data.calls)).flatMap(([name, n]) =>
        typeof n === 'number' ? [[sharedToolLabel(name), n] as const] : [],
      )
      const total = made.reduce((sum, [, n]) => sum + n, 0)
      const top = made
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
        .join(' · ')
      return reply('Ran a script', 'Running a script', 'terminal', top || undefined, [
        ...(total ? [{ label: 'Calls', value: String(total) }] : []),
        ...(text(data.error) ? [{ label: 'Failed', value: clip(text(data.error)!, 160) }] : []),
      ])
    }
    default:
      return reply('Used', 'Using', 'wrench', call.name.replace(/_/g, ' '))
  }
}

/** A Shared MCP tool's provider-safe name (`linear-1a2b3c__get_issue`) as a person reads it: `linear: get_issue`. */
const sharedToolLabel = (name: string) =>
  name.replace(/^(?:mcp__)?shared_mcp(?:__|\.|_)/, '').replace(/^(.+?)-[0-9a-f]{6}__/, '$1: ')

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
      return reply('Background command stopped printing', running, 'terminal', subject, facts)
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
