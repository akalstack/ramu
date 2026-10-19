import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSessionInfo, AppPreferences, McpConnection } from '@ramu/shared/types'
import { claudeMcpServers, claudeMcpEnvironment } from '../providers/claudeMcp'
import { providerAdapter } from '../providers/adapters'
import { providerEnvironment } from '../providers/providerBinaries'
import { baseMode } from './settings'

/** What building a chat's Claude options needs from the service. */
export interface ClaudeLaunch {
  session: AgentSessionInfo
  connection: McpConnection | undefined
  /** Claude Code's `advisorModel`: a model, '' to turn its advisor off for Ramu's, or undefined for the user's setting. */
  advisorModel: string | undefined
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
  advisorModel,
  abort,
  canUseTool,
  resume,
  preferences,
  hooks,
}: ClaudeLaunch): Options {
  const env = providerEnvironment('claude-code', preferences?.().providerBinaries, s.settings.accountId ?? 'default')
  const plugins = connection?.skillsDir
    ? (providerAdapter('claude-code').skillsLaunch?.(connection.skillsDir).plugins ?? [])
    : []
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
            ...(claudeMcpServers(s, connection.mcpConfigDirs, env) as NonNullable<Options['mcpServers']>),
            ramu: {
              type: 'http' as const,
              url: connection.url,
              headers: { Authorization: `Bearer ${connection.token}` },
            },
          },
        }
      : {}),
    settingSources: ['user', 'project', 'local'],
    ...(plugins.length ? { plugins: plugins.map((path) => ({ type: 'local' as const, path })) } : {}),
    // Overrides the user's settings. Newer Claude models omit thinking text unless summaries are requested, which
    // would leave the chat's thinking rows empty. `advisorModel` is Claude Code's own advisor on the configured model,
    // or off while Ramu's runs.
    settings: { showThinkingSummaries: true, ...(advisorModel !== undefined ? { advisorModel } : {}) },
    ...(s.additionalDirs.length ? { additionalDirectories: s.additionalDirs } : {}),
    abortController: abort,
    canUseTool,
    permissionMode: baseMode(s.settings),
    // A review chat about learned memories has no built-in file, shell or Git tools, only Ramu's own.
    ...(connection?.restricted ? { tools: [] } : {}),
    ...(s.settings.access === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(s.settings.model ? { model: s.settings.model } : {}),
    ...(s.settings.effort ? { effort: s.settings.effort as Options['effort'] } : {}),
    ...(resume ? { resume } : {}),
    env: connection ? claudeMcpEnvironment(env) : env,
    ...(hooks ? { hooks } : {}),
    // Sub-agents get their own transcript and progress line in the chat.
    forwardSubagentText: true,
    includePartialMessages: true,
  }
}
