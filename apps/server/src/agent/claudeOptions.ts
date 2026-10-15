import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSessionInfo, AppPreferences, McpConnection } from '@ramu/shared/types'
import { providerEnvironment } from '../providers/providerBinaries'
import { baseMode } from './settings'

/** What building a chat's Claude options needs from the service. */
export interface ClaudeLaunch {
  session: AgentSessionInfo
  connection: McpConnection | undefined
  /** Whether Ramu's advisor replaces Claude Code's own. */
  advisorOn: boolean
  abort: AbortController
  canUseTool: CanUseTool
  resume: string | null
  preferences: (() => AppPreferences) | undefined
  /** Sub-agent hooks, set for main chats only. */
  hooks: Options['hooks'] | undefined
}

/** The SDK options for a chat's long-lived Claude query, always rooted in the session's binding cwd. */
export function claudeLaunchOptions({
  session: s,
  connection,
  advisorOn,
  abort,
  canUseTool,
  resume,
  preferences,
  hooks,
}: ClaudeLaunch): Options {
  return {
    cwd: s.cwd,
    ...(connection
      ? {
          systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: connection.instructions!,
          },
        }
      : {}),
    ...(connection
      ? {
          mcpServers: {
            ramu: {
              type: 'http' as const,
              url: connection.url,
              headers: { Authorization: `Bearer ${connection.token}` },
            },
          },
        }
      : {}),
    settingSources: ['user', 'project', 'local'],
    // Ramu's advisor replaces Claude Code's own, which an empty advisorModel turns off over the user's settings.
    ...(advisorOn ? { settings: { advisorModel: '' } } : {}),
    ...(s.additionalDirs.length ? { additionalDirectories: s.additionalDirs } : {}),
    abortController: abort,
    canUseTool,
    permissionMode: baseMode(s.settings),
    ...(s.settings.access === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(s.settings.model ? { model: s.settings.model } : {}),
    ...(s.settings.effort ? { effort: s.settings.effort as Options['effort'] } : {}),
    ...(resume ? { resume } : {}),
    ...(connection || (s.settings.accountId && s.settings.accountId !== 'default')
      ? {
          env: {
            ...providerEnvironment('claude-code', preferences?.().providerBinaries, s.settings.accountId ?? 'default'),
            ...(connection ? { MCP_TOOL_TIMEOUT: String(3_600_000) } : {}),
          },
        }
      : {}),
    ...(hooks ? { hooks } : {}),
    // Sub-agents get their own transcript and progress line in the chat.
    forwardSubagentText: true,
    includePartialMessages: true,
  }
}
