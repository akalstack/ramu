import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { z } from 'zod'
import type { TerminalService } from '../workspace/pty'

export const BACKGROUND_TERMINAL_GUIDE = `Use background_terminal_launch for a development server or watcher that should remain running after your reply. The user can inspect and stop it in Background terminals. Commands run on this thread's execution host, in this session's checkout, and end when the host server restarts. This path requires Full access; otherwise use the provider's native command tool and permission flow. Never use it to bypass a restriction. Do not restart a command the user stopped without a new instruction.`

/** The authenticated MCP connection supplies the session; tool arguments cannot select a host, thread or cwd. */
export function registerBackgroundTerminalTools(
  server: McpServer,
  terminals: TerminalService,
  source: AgentSessionInfo,
  current: () => AgentSessionInfo,
) {
  const scope = (execute = false) => {
    const session = current()
    if (session.id !== source.id || session.taskId !== source.taskId || session.cwd !== source.cwd)
      throw new Error('The terminal session scope changed. Reconnect before trying again.')
    // App-owned MCP tools can be auto-approved by providers. They must not become an unrestricted shell escape.
    if (execute && (source.settings.access !== 'full' || session.settings.access !== 'full'))
      throw new Error(
        'Managed background commands require Full access. Use the native command permission flow instead.',
      )
    return session
  }
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'background_terminal_launch',
    { description: BACKGROUND_TERMINAL_GUIDE, inputSchema: { command: z.string().trim().min(1).max(4000) } },
    ({ command }) => {
      const session = scope(true)
      return result(terminals.launchBackground(session.taskId, session.repoId, session.cwd, command))
    },
  )
  server.registerTool(
    'background_terminal_list',
    {
      description: 'List managed background commands belonging to this thread, including completed commands.',
      inputSchema: {},
    },
    () => result(terminals.listBackground(scope().taskId)),
  )
  server.registerTool(
    'background_terminal_inspect',
    {
      description:
        'Read state and the most recent output of a managed background command in this thread. Output is a bounded tail; cursor counts all output characters.',
      inputSchema: { id: z.string().uuid() },
    },
    ({ id }) => result(terminals.inspectBackground(scope().taskId, id)),
  )
  server.registerTool(
    'background_terminal_stop',
    {
      description:
        'Stop a managed command in this thread. Full access is required. Request graceful stop first; force is only available after that request. Final output stays readable.',
      inputSchema: { id: z.string().uuid(), force: z.boolean().default(false) },
    },
    ({ id, force }) => {
      const session = scope(true)
      const command = terminals.inspectBackground(session.taskId, id)
      if (force && command.state === 'running') throw new Error('Request graceful stop before force stop.')
      if (force && !command.capabilities.forceStop) throw new Error('Force stop is unavailable on this host.')
      return result(terminals.stopBackground(session.taskId, id, force))
    },
  )
}
