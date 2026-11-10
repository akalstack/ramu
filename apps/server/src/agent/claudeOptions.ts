import type { CanUseTool, OnUserDialog, Options } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_IDLE_COMPACTION } from '@ramu/shared/chat/idleCompaction'
import type { AgentSessionInfo, AppPreferences, McpConnection } from '@ramu/shared/types'
import { claudeMcpServers, claudeMcpEnvironment } from '../providers/claudeMcp'
import { providerAdapter } from '../providers/adapters'
import { providerEnvironment } from '../providers/providerBinaries'
import { baseMode } from './settings'
import { sharedSessionServers } from './projectSetup'
import { EXTERNAL_MCP_SERVER } from '../mcp/sessionTools'

/** Servers shared through Agent setup that this Claude account does not already load from its own configuration. */
function claudeSharedServers(
  s: { cwd: string; additionalDirs: string[]; covers: string[] },
  configDirs: string[] = [],
  env: NodeJS.ProcessEnv,
  projectId?: string,
): NonNullable<Options['mcpServers']> {
  const dirs = [...new Set([s.cwd, ...s.additionalDirs, ...s.covers, ...configDirs])]
  return Object.fromEntries(
    sharedSessionServers(dirs, 'claude-code', env, { projectId }).map((server) => [
      server.name,
      server.transport.type === 'http'
        ? { type: 'http' as const, url: server.transport.url, headers: server.headers }
        : { command: server.transport.command, args: server.transport.args, env: server.env },
    ]),
  )
}

/** What building a chat's Claude options needs from the service. */
export interface ClaudeLaunch {
  session: AgentSessionInfo
  connection: McpConnection | undefined
  /** Claude Code's `advisorModel`: a model, '' to turn its advisor off for Ramu's, or undefined for the user's setting. */
  advisorModel: string | undefined
  abort: AbortController
  canUseTool: CanUseTool
  /** Answers Claude's return prompt for a long idle thread; main threads only. */
  onUserDialog?: OnUserDialog
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
  onUserDialog,
  resume,
  preferences,
  hooks,
}: ClaudeLaunch): Options {
  const idleCompaction = preferences?.().idleCompaction ?? DEFAULT_IDLE_COMPACTION
  const env = providerEnvironment(
    'claude-code',
    preferences?.().providerBinaries,
    s.settings.accountId ?? 'default',
    s.cwd,
  )
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
            ...claudeSharedServers(s, connection.mcpConfigDirs, env, connection.sharingProjectId),
            ...(connection.externalUrl
              ? {
                  [EXTERNAL_MCP_SERVER]: {
                    type: 'http' as const,
                    url: connection.externalUrl,
                    headers: { Authorization: `Bearer ${connection.token}` },
                  },
                }
              : {}),
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
    // or off while Ramu's runs. Empty attribution keeps Claude Code's co-author trailer and footer out of commits
    // and pull requests. Claude Code's own idle compaction would compact on its own schedule; it stays on only when
    // the person asked to be asked on return, and Ramu times it itself before the cache expires.
    settings: {
      showThinkingSummaries: true,
      ...(idleCompaction !== 'onReturn' ? { idleCompaction: false } : {}),
      ...(advisorModel !== undefined ? { advisorModel } : {}),
      ...(preferences?.().removeAgentCredits !== false
        ? { attribution: { commit: '', pr: '', sessionUrl: false } }
        : {}),
    },
    ...(s.additionalDirs.length ? { additionalDirectories: s.additionalDirs } : {}),
    abortController: abort,
    canUseTool,
    // Claude raises its return prompt only for a dialog kind the host declares it can show.
    ...(onUserDialog ? { onUserDialog, supportedDialogKinds: ['resume_return'] } : {}),
    permissionMode: baseMode(s.settings),
    // A review chat about learned memories has no built-in file, shell or Git tools, only Ramu's own.
    ...(connection?.restricted ? { tools: [] } : {}),
    // Ramu's ask_user serves every question, so the model has no second tool to pick for the same job.
    ...(connection?.replaceQuestions ? { disallowedTools: ['AskUserQuestion'] } : {}),
    ...(s.settings.access === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(s.settings.model ? { model: s.settings.model } : {}),
    ...(s.settings.effort ? { effort: s.settings.effort as Options['effort'] } : {}),
    // Models with effort levels think adaptively but omit the text unless summaries are requested on the request itself;
    // the setting above does not reach headless sessions, which left Claude chats without thinking rows.
    ...(s.settings.effort ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
    ...(resume ? { resume } : {}),
    env: connection ? claudeMcpEnvironment(env) : env,
    ...(hooks ? { hooks } : {}),
    // Sub-agents get their own transcript and progress line in the chat.
    forwardSubagentText: true,
    includePartialMessages: true,
  }
}
