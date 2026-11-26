import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export const BACKGROUND_WAIT_GUIDE =
  "When you end your reply while a command you started with your shell tool's background option is still running and you will continue when it ends (tests, a build), call background_wait with its id first, so the thread keeps showing as working. Not for a dev server or watcher."

/**
 * The authenticated MCP connection supplies the session, so a call can only mark that session's own commands. Ramu
 * cannot tell a command the agent will come back to from one left running, so the agent says which it is waiting on.
 */
export function registerBackgroundWaitTools(
  server: McpServer,
  mark: (taskIds: string[], waiting: boolean) => { matched: string[]; unmatched: string[] },
) {
  server.registerTool(
    'background_wait',
    {
      description:
        'Keep this thread showing as working while a background command you started is still running and you will continue when it ends (tests, a build). Pass its id once it has started. Not for commands left running, such as a dev server or watcher. waiting=false clears it. It does not stop anything. Ids that match no running command of this thread come back in unmatched.',
      inputSchema: {
        taskIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
        waiting: z.boolean().optional(),
      },
    },
    ({ taskIds, waiting }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(mark(taskIds, waiting !== false)) }],
    }),
  )
}
