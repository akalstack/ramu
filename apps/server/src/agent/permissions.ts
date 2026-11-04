import { matchesCommand } from './permissionApprovals'
import { randomUUID } from 'node:crypto'
import type { CanUseTool, Options, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { dangerousCommand, type CommandScope } from './dangerousCommands'
import type { AgentEvent, AgentQuestion, AgentSessionState, AgentSettings } from '@ramu/shared/types'
import { summarizeInput } from './toolSummaries'
import type { PendingRequest } from './types'

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
 * Full access asks before the few commands that can destroy work or the machine. Bypass mode never calls `canUseTool`
 * on its own for a command, so this hook turns the call into an ask, which then reaches it.
 */
export function dangerousCommandHooks(scope: CommandScope): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return {}
            const command = (input.tool_input as { command?: unknown } | undefined)?.command
            const reason = typeof command === 'string' ? dangerousCommand(command, scope) : null
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
export const READ_ONLY_DENIED = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']

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
      if (restricted)
        return resolve(
          /^mcp__ramu__/.test(toolName)
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: 'This review thread can only use Ramu memory and skill tools.' },
        )
      // Auto and Full access trust the app-owned MCP server, including tools discovered through tool_invoke.
      // Their handlers still enforce session scope and any tool-specific checks.
      if ((settings.access === 'auto' || settings.access === 'full') && /^mcp__ramu__/.test(toolName))
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      // Shared MCP tools are authorized again on the host for every call, and its gateway asks the person itself when
      // the approval requires it, so asking here too would show two cards for one call. Review chats never get here.
      if (/^mcp__shared_mcp__/.test(toolName)) return resolve({ behavior: 'allow', updatedInput: toolInput })
      // Browser handlers enforce their own run-scoped approval, including deferred calls. Asking twice would grant
      // nothing extra; the browser approval never authorizes another app tool or a native provider browser.
      // Computer tools do the same: enabling computer use is the grant, and their handlers ask on their own when it is off.
      if (
        /^mcp__ramu__(browser|computer)_/.test(toolName) ||
        (toolName === 'mcp__ramu__tool_invoke' &&
          typeof toolInput.name === 'string' &&
          /^(browser|computer)_/.test(toolInput.name))
      )
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      // These scoped tools only manage questions; they never authorize file or command access.
      if (
        /^mcp__ramu__(ask_user|question_status|wait_for_answer|close_question|advisor|wait_for_advice|set_goal|get_goal|update_goal|tool_search|tool_result_read|memory_read|session_recall|session_search)$/.test(
          toolName,
        )
      )
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
          detail: [
            decisionReason,
            fullAccessAsk ? 'Full access still asks before this.' : '',
            summarizeInput(toolInput),
          ]
            .filter(Boolean)
            .join('\n'),
          approvalOnceOnly: suppressAlwaysAllowRule || fullAccessAsk,
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
