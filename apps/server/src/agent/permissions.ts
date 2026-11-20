import { matchesCommand } from './permissionApprovals'
import { randomUUID } from 'node:crypto'
import type { CanUseTool, Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { alwaysAsks, type CommandScope } from './dangerousCommands'
import { readsOnly } from './autoCommandRules'
import type { AgentEvent, AgentQuestion, AgentSessionState, AgentSettings } from '@ramu/shared/types'
import { summarizeInput } from './toolSummaries'
import type { PendingRequest } from './types'
import { mcpCallSkipsCard } from './toolApprovals'

/** What the permission callback needs from the service. */
export interface PermissionHost {
  settings: AgentSettings
  /** Requests waiting for the user's answer, keyed by request id. */
  pending: Map<string, PendingRequest>
  record(event: AgentEvent): void
  setState(state: AgentSessionState): void
  /** A review chat about learned memories: Ramu's own tools only. */
  restricted?: boolean
  /** A Review teammate: it may read, never write. */
  readOnly?: boolean
}

/**
 * Commands that ask whatever the access level allows: under full access the few that can destroy work or the machine,
 * and at every level a production deploy. Bypass mode, Claude's own auto mode and a saved allow rule never call
 * `canUseTool` for such a command, so this hook turns the call into an ask, which then reaches it.
 */
export function alwaysAskHooks(scope: CommandScope, access: AgentSettings['access']): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return {}
            const command = (input.tool_input as { command?: unknown } | undefined)?.command
            const reason = typeof command === 'string' ? alwaysAsks(command, scope, access) : null
            return reason
              ? {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'ask' as const,
                    permissionDecisionReason: reason,
                  },
                }
              : {}
          },
        ],
      },
    ],
  }
}

/** Several hook sets as one: each event keeps every set's matchers. */
export function claudeHooks(...sets: (Options['hooks'] | undefined)[]): Options['hooks'] {
  const merged: NonNullable<Options['hooks']> = {}
  for (const set of sets)
    for (const [event, matchers] of Object.entries(set ?? {}) as [keyof NonNullable<Options['hooks']>, never[]][])
      merged[event] = [...(merged[event] ?? []), ...matchers]
  return Object.keys(merged).length ? merged : undefined
}

/** Claude tools a read-only session may not use, even with full access, because each can change files. */
export const READ_ONLY_DENIED = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const READ_ONLY_COMMAND =
  'You are a read-only reviewer: commands may only read (ls, cat, grep, find, git status, diff, log, show…). This one could change something or run a program, so it did not run. Read the files instead, or name the command in your findings for the lead to run.'

/**
 * A read-only session keeps Bash for commands that only read, decided before the call in every permission mode: a
 * read runs without asking, anything else is refused with the reason.
 */
export function readOnlyBashHooks(): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return {}
            const command = (input.tool_input as { command?: unknown } | undefined)?.command
            const reads = typeof command === 'string' && readsOnly(command)
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: reads ? ('allow' as const) : ('deny' as const),
                ...(reads ? {} : { permissionDecisionReason: READ_ONLY_COMMAND }),
              },
            }
          },
        ],
      },
    ],
  }
}

/** Claude's `canUseTool` hook: auto-allows Ramu's own tools, otherwise asks the user. */
export function createCanUseTool({
  settings,
  pending,
  record,
  setState,
  restricted,
  readOnly,
}: PermissionHost): CanUseTool {
  return (toolName, toolInput, { signal, title, decisionReason, suggestions, suppressAlwaysAllowRule, blockedPath }) =>
    new Promise<PermissionResult>((resolve) => {
      if (readOnly && READ_ONLY_DENIED.includes(toolName))
        return resolve({ behavior: 'deny', message: 'You are a read-only reviewer. Read files and report findings.' })
      if (readOnly && toolName === 'Bash')
        return resolve(
          typeof toolInput.command === 'string' && readsOnly(toolInput.command)
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: READ_ONLY_COMMAND },
        )
      if (restricted)
        return resolve(
          /^mcp__ramu__/.test(toolName)
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: 'This review thread can only use Ramu memory and skill tools.' },
        )
      // The same rule every provider follows: Auto and Full trust Ramu's own server, a tool that asks the person itself
      // needs no second card, and Shared MCP calls are asked for by their gateway. See toolApprovals.ts.
      const ramuName = /^mcp__ramu__(.+)$/.exec(toolName)?.[1]
      const server = ramuName ? 'ramu' : /^mcp__shared_mcp__/.test(toolName) ? 'shared_mcp' : 'other'
      if (mcpCallSkipsCard(settings.access, server, ramuName ?? toolName, toolInput))
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      // Full access runs as bypassPermissions, where Claude only calls this for its own safety checks, an ask rule in
      // the person's settings, or Ramu's dangerous-command hook. Each needs the person, once, for this exact call.
      const fullAccessAsk = settings.access === 'full' && toolName !== 'AskUserQuestion'
      const requestId = randomUUID()
      pending.set(requestId, {
        kind: toolName === 'AskUserQuestion' ? 'question' : 'permission',
        input: toolInput,
        resolve,
      })
      signal.addEventListener('abort', () => pending.delete(requestId))
      if (toolName === 'AskUserQuestion') {
        record({ kind: 'question', requestId, questions: (toolInput.questions ?? []) as AgentQuestion[] })
      } else {
        record({
          kind: 'permission-request',
          requestId,
          toolName,
          title: title ?? `Allow ${toolName}?`,
          detail: [fullAccessAsk ? '' : decisionReason, summarizeInput(toolInput)].filter(Boolean).join('\n'),
          approvalOnceOnly: suppressAlwaysAllowRule || fullAccessAsk,
          ...(fullAccessAsk ? { approvalFullAccess: { ...(decisionReason ? { reason: decisionReason } : {}) } } : {}),
          approvalPatterns:
            !fullAccessAsk && toolName === 'Bash' && !blockedPath && typeof toolInput.command === 'string'
              ? [
                  ...new Set(
                    (suggestions ?? []).flatMap((update) =>
                      update.type === 'addRules' && update.behavior === 'allow'
                        ? update.rules.flatMap((rule) =>
                            rule.toolName === 'Bash' &&
                            rule.ruleContent &&
                            matchesCommand(rule.ruleContent, toolInput.command as string)
                              ? [rule.ruleContent]
                              : [],
                          )
                        : [],
                    ),
                  ),
                ]
              : undefined,
        })
      }
      setState('needs-input')
    })
}
