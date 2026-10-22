import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentScope } from '@ramu/shared/types'
import { discoverMcpServers, type DiscoveredMcpServer } from '../context'

/** Claude local MCP entries are keyed by the original project path, not a task's worktree path. */
export function claudeMcpServers(
  scope: AgentScope,
  configDirs: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, DiscoveredMcpServer> {
  const dirs = [...new Set([scope.cwd, ...scope.additionalDirs, ...scope.covers, ...configDirs])]
  let projects: Record<string, { mcpServers?: Record<string, DiscoveredMcpServer>; disabledMcpServers?: string[] }> = {}
  try {
    const file = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')
    projects = JSON.parse(readFileSync(file, 'utf8')).projects ?? {}
  } catch {
    // Missing or malformed local config does not hide repository MCPs.
  }
  const local: Record<string, DiscoveredMcpServer> = Object.create(null)
  for (const dir of dirs) {
    const entries = projects[dir]?.mcpServers
    const disabled = projects[dir]?.disabledMcpServers
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    for (const [name, server] of Object.entries(entries)) {
      if (
        name === 'ramu' ||
        name === 'shared_mcp' ||
        (Array.isArray(disabled) && disabled.includes(name)) ||
        Object.hasOwn(local, name) ||
        !server ||
        typeof server !== 'object'
      )
        continue
      if (typeof server.command === 'string' || typeof server.url === 'string') local[name] = server
    }
  }
  // Local scope takes precedence over repository .mcp.json; user/global config remains owned by Claude.
  return {
    ...discoverMcpServers(
      { cwd: scope.cwd, additionalDirs: [...scope.additionalDirs, ...scope.covers, ...configDirs], covers: [] },
      ['ramu', 'shared_mcp'],
    ),
    ...local,
  }
}

/** Allow slow MCP handshakes to finish before Claude answers its first prompt. Explicit host values win. */
export function claudeMcpEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    MCP_TIMEOUT: env.MCP_TIMEOUT ?? '60000',
    CLAUDE_CODE_MCP_STARTUP_WAIT_MS: env.CLAUDE_CODE_MCP_STARTUP_WAIT_MS ?? '60000',
    MCP_TOOL_TIMEOUT: String(3_600_000),
  }
}
