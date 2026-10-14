import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentSessionInfo } from '@ramu/shared/types'

/** Explicit opt-in command path. Never installs global hooks or changes native shell commands. */
export function registerRtkTool(server: McpServer, session: AgentSessionInfo) {
  if (session.settings.access !== 'full') return
  server.registerTool('rtk_run', {
    description: 'Run an installed RTK command in this chat working directory for compact command output. Full-access chats only. Arguments go directly to rtk, without a shell. Native provider shell tools are unchanged. RTK output is filtered by RTK; it is not the original underlying command output.',
    inputSchema: { arguments: z.array(z.string().max(4000).refine((value) => !value.includes('\0'))).min(1).max(100), timeoutSeconds: z.number().int().min(1).max(120).default(60) },
  }, ({ arguments: args, timeoutSeconds }, extra) => new Promise((resolve) => {
    execFile('rtk', args, { cwd: session.cwd, timeout: timeoutSeconds * 1000, signal: extra.signal, maxBuffer: 2_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      const missing = error && 'code' in error && error.code === 'ENOENT'
      resolve({ ...(error ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify({ exitCode: error && 'code' in error ? error.code : 0, stdout, stderr, error: missing ? 'RTK is not installed or not on the server PATH. Install RTK or use the provider shell.' : error?.message ?? null }) }] })
    })
  }))
}
