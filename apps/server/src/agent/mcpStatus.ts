import type { AgentMcpServer } from '@ramu/shared/types'
import { redactSecrets } from '../memory/secrets'

/** Only display fields cross the client boundary; never return MCP configs, headers or tool definitions. */
export function mcpServerDetails(
  servers: { name: string; status: string; error?: string; tools?: unknown[]; toolCount?: number }[],
): AgentMcpServer[] {
  return servers.map((server) => ({
    name: server.name,
    status: server.status,
    ...(server.tools
      ? { toolCount: server.tools.length }
      : server.toolCount !== undefined
        ? { toolCount: server.toolCount }
        : {}),
    ...(server.error
      ? { error: redactSecrets(server.error.replace(/https?:\/\/[^\s)]+/g, '[server URL]')).slice(0, 2000) }
      : {}),
  }))
}

export async function mcpRequest<T>(request: Promise<T>, timeout = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('MCP request timed out. The servers may still be connecting; refresh to check again.')),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
