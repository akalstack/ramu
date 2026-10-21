import { matchesCommand } from './permissionApprovals'
import { randomUUID } from 'node:crypto'
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
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
}

/** Claude's `canUseTool` hook: auto-allows Ramu's own tools and full access, otherwise asks the user. */
export function createCanUseTool({ settings, pending, record, setState, restricted }: PermissionHost): CanUseTool {
  return (toolName, toolInput, { signal, title, decisionReason, suggestions, suppressAlwaysAllowRule, blockedPath }) =>
    new Promise<PermissionResult>((resolve) => {
      if (restricted)
        return resolve(
          /^mcp__ramu__/.test(toolName)
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: 'This review thread can only use Ramu memory and skill tools.' },
        )
      // Auto trusts the app-owned MCP server, including tools discovered through tool_invoke.
      // Their handlers still enforce session scope and any tool-specific checks.
      if (settings.access === 'auto' && /^mcp__ramu__/.test(toolName))
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      // Browser handlers enforce their own run-scoped approval, including deferred calls. Asking twice would grant
      // nothing extra; the browser approval never authorizes another app tool or a native provider browser.
      if (
        /^mcp__ramu__browser_/.test(toolName) ||
        (toolName === 'mcp__ramu__tool_invoke' &&
          typeof toolInput.name === 'string' &&
          /^browser_/.test(toolInput.name))
      )
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      // These scoped tools only manage questions; they never authorize file or command access.
      if (
        /^mcp__ramu__(ask_user|question_status|wait_for_answer|close_question|advisor|wait_for_advice|set_goal|get_goal|update_goal|tool_search|tool_result_read|memory_read|session_recall|session_search)$/.test(
          toolName,
        )
      )
        return resolve({ behavior: 'allow', updatedInput: toolInput })
      if (settings.access === 'full' && toolName !== 'AskUserQuestion')
        return resolve({ behavior: 'allow', updatedInput: toolInput })
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
          detail: [decisionReason, summarizeInput(toolInput)].filter(Boolean).join('\n'),
          approvalOnceOnly: suppressAlwaysAllowRule,
          approvalPatterns:
            toolName === 'Bash' && !blockedPath && typeof toolInput.command === 'string'
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
