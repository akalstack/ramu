import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { terminalTail } from '@ramu/shared/workspace/terminalText'
import { z } from 'zod'
import { redactSecrets } from '../memory/secrets'
import type { TerminalService } from '../workspace/pty'

export const USER_TERMINAL_GUIDE = `The person's own terminals in this thread are readable with terminal_list and terminal_read. When they mention an error, a failing command or output they see in their terminal, read it yourself instead of asking them to paste it. These tools only read; never type into the person's terminals. Values that look like secrets are redacted.`

const READ_DEFAULT = 200
const READ_MAX = 2000

/** Read-only access to the shells the person opened in this thread. The connection, not an argument, names the thread. */
export function registerUserTerminalTools(
  server: McpServer,
  terminals: TerminalService,
  source: AgentSessionInfo,
  current: () => AgentSessionInfo,
) {
  const taskId = () => {
    const session = current()
    if (session.id !== source.id || session.taskId !== source.taskId)
      throw new Error('The terminal session scope changed. Reconnect before trying again.')
    return session.taskId
  }
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  server.registerTool(
    'terminal_list',
    {
      description:
        "List the person's terminals in this thread, oldest first: id, working directory, whether the shell ended and the program running in it now (null at a prompt). Background commands you launched are listed by background_terminal_list instead.",
      inputSchema: {},
    },
    () => result(terminals.listShells(taskId()).map((shell, index) => ({ ...shell, name: `Terminal ${index + 1}` }))),
  )
  server.registerTool(
    'terminal_read',
    {
      description:
        "Read the recent output of one of the person's terminals as plain text, colors removed. Without an id, reads the terminal that printed most recently. Returns the last `lines` lines (default 200).",
      inputSchema: {
        id: z.string().uuid().optional(),
        lines: z.number().int().min(1).max(READ_MAX).default(READ_DEFAULT),
      },
    },
    ({ id, lines }) => {
      const task = taskId()
      const shells = terminals.listShells(task)
      if (!shells.length) throw new Error('The person has no terminal open in this thread.')
      const shell = id ? shells.find((entry) => entry.id === id) : terminals.latestShell(task)
      if (!shell) throw new Error(`Unknown terminal ${id}. Call terminal_list for the terminals in this thread.`)
      const tail = terminalTail(terminals.shellOutput(task, shell.id), lines)
      return result({
        id: shell.id,
        name: `Terminal ${shells.findIndex((entry) => entry.id === shell.id) + 1}`,
        cwd: shell.cwd,
        exited: shell.exited,
        running: shell.running,
        lines: tail.lines,
        olderLines: tail.total - tail.lines,
        output: redactSecrets(tail.text),
      })
    },
  )
}
