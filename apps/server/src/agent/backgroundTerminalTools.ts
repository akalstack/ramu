import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { z } from 'zod'
import type { TerminalService } from '../workspace/pty'
import { dangerousCommand } from './dangerousCommands'

export const BACKGROUND_TERMINAL_GUIDE = `Use background_terminal_launch for a development server or watcher that should remain running after your reply. The user can inspect and stop it in Background terminals. Commands run on this thread's execution host, in this session's checkout. After a host restart, saved commands without a verified process handle are Unknown and their saved output is read-only; inspect and verify them before starting anything again. Ramu never replays saved launches automatically. In Full access it launches directly unless the command can destroy work or the machine; otherwise each launch asks the person to approve the exact command once, and a refusal must be respected. Never use it to bypass a restriction. A command whose stoppedBy is "user" was stopped by the person; do not restart it without a new instruction.

To wait for background commands, call background_terminal_wait instead of sleeping or polling inspect: it returns when a command exits, prints text you name (such as "ready" or "error"), goes quiet, or the timeout passes, with the new output. Wait before you rely on a server, finish your turn or report a result that depends on the command.`

/** The authenticated MCP connection supplies the session; tool arguments cannot select a host, thread or cwd. */
export function registerBackgroundTerminalTools(
  server: McpServer,
  terminals: TerminalService,
  source: AgentSessionInfo,
  current: () => AgentSessionInfo,
  /** Asks the person through the thread's existing approval prompt. Resolves false when refused. */
  requestApproval?: (detail: string, signal?: AbortSignal) => Promise<boolean>,
) {
  const unchanged = (session: AgentSessionInfo) =>
    session.id === source.id && session.taskId === source.taskId && session.cwd === source.cwd
  const full = (session: AgentSessionInfo) => source.settings.access === 'full' && session.settings.access === 'full'
  const scope = () => {
    const session = current()
    if (!unchanged(session)) throw new Error('The terminal session scope changed. Reconnect before trying again.')
    return session
  }
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'background_terminal_launch',
    { description: BACKGROUND_TERMINAL_GUIDE, inputSchema: { command: z.string().trim().min(1).max(4000) } },
    async ({ command }, extra) => {
      let session = scope()
      // App-owned MCP tools can be auto-approved by providers, so outside Full access every launch needs the person's
      // approval of this exact command. The approval is single-use and bound to the access mode it was asked under.
      // Full access still asks before the few commands that can destroy work or the machine.
      const danger = full(session) ? dangerousCommand(command, session) : null
      if (!full(session) || danger) {
        if (!requestApproval)
          throw new Error(
            danger
              ? `${danger}, and this connection cannot ask the person to approve it. Do not run it another way.`
              : 'Managed background commands require Full access on this host. Use the native command permission flow instead.',
          )
        const access = session.settings.access
        const allowed = await requestApproval(
          `${danger ? `${danger}. ` : ''}Run this command in the background and keep it running after the reply:\n\n${command}`,
          extra.signal,
        )
        if (!allowed)
          throw new Error('The person declined this background command. Do not retry it without a new request.')
        session = scope()
        if (session.settings.access !== access)
          throw new Error('Access changed while waiting. Request the command again.')
      }
      return result(
        terminals.launchBackground(session.taskId, null, session.cwd, command, source.parentId ? 'helper' : undefined),
      )
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
    'background_terminal_wait',
    {
      description:
        'Wait for managed background commands in this thread instead of sleeping or polling. Returns when a command exits, its output contains one of outputIncludes (case-insensitive, colors ignored), it writes nothing for quietSeconds, or timeoutSeconds passes. With mode "all", waits until every command has exited or matched. Output printed before the call counts unless newOutputOnly is true; set it when waiting for the next rebuild of a watcher. Reports why it returned, each command\'s state and exit code, and the last output.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1).max(8),
        outputIncludes: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
        mode: z.enum(['any', 'all']).default('any'),
        newOutputOnly: z.boolean().default(false),
        quietSeconds: z.number().int().min(2).max(600).optional(),
        timeoutSeconds: z.number().int().min(1).max(1800).default(300),
      },
    },
    async ({ ids, outputIncludes, mode, newOutputOnly, quietSeconds, timeoutSeconds }, extra) =>
      result(
        await terminals.waitBackground(scope().taskId, ids, {
          mode,
          includes: outputIncludes,
          newOutputOnly,
          ...(quietSeconds === undefined ? {} : { quietMs: quietSeconds * 1000 }),
          timeoutMs: timeoutSeconds * 1000,
          signal: extra.signal,
        }),
      ),
  )
  server.registerTool(
    'background_terminal_stop',
    {
      description:
        'Stop a managed command in this thread. Request graceful stop first; force is only available after that request. Final output stays readable.',
      inputSchema: { id: z.string().uuid(), force: z.boolean().default(false) },
    },
    ({ id, force }) => {
      const session = scope()
      const command = terminals.inspectBackground(session.taskId, id)
      if (!command.capabilities.stop && command.state === 'unknown')
        throw new Error(
          'No verified process handle is available. Inspect saved output and verify the command on its host; it cannot be stopped through this record.',
        )
      if (force && command.state === 'running') throw new Error('Try a normal stop before force stop.')
      if (force && !command.capabilities.forceStop) throw new Error('Force stop is unavailable on this host.')
      return result(terminals.stopBackground(session.taskId, id, force))
    },
  )
}
