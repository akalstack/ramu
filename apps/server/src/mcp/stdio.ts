import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { SharedMcpConnection } from '@ramu/shared/mcp'

/** Shared by host-owned integrations. Implementations must fail when secure storage is unavailable/locked.
 * There is deliberately no plaintext, environment-variable or provider-token fallback. */
export interface HostSecretReader {
  read(input: { hostId: string; connectionId: string; serviceAccountId: string; reference: string }): Promise<string>
  /** Replaces the value behind an existing reference in place (OAuth refresh), keeping the definition unchanged. */
  write?(
    input: { hostId: string; connectionId: string; serviceAccountId: string; reference: string },
    value: string,
  ): Promise<void>
}

/** Only explicitly reviewed local commands may reach this factory. This is host execution, not a sandbox.
 * The MCP SDK spawns an argument array without a shell and inherits only its small platform environment allowlist.
 * It does not inherit provider/gateway bearer tokens or arbitrary process environment values. */
export async function connectSharedMcpStdio(
  connection: SharedMcpConnection,
  signal: AbortSignal,
  secrets?: HostSecretReader,
): Promise<Client> {
  if (connection.transport.type !== 'stdio') throw new Error('This connection needs an HTTP MCP client')
  signal.throwIfAborted()
  const env: Record<string, string> = {}
  const reserved = /^(?:RAMU_|CODEX_|CLAUDE_|NODE_OPTIONS$|NODE_PATH$|LD_|DYLD_)/i
  for (const [name, reference] of Object.entries(connection.transport.envSecretRefs)) {
    // Secret references cannot inject runtime startup hooks or Ramu/provider control credentials.
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || reserved.test(name))
      throw new Error('This environment variable is not supported for external MCP servers')
    if (!secrets) throw new Error('Set up a secure host credential store before using environment secrets')
    try {
      env[name] = await secrets.read({
        hostId: connection.hostId,
        connectionId: connection.id,
        serviceAccountId: connection.serviceAccountId,
        reference,
      })
    } catch {
      throw new Error('The secure host credential store is unavailable or locked')
    }
    signal.throwIfAborted()
  }
  const transport = new StdioClientTransport({
    command: connection.transport.command,
    args: connection.transport.args,
    cwd: connection.transport.cwd,
    env,
    stderr: 'ignore',
    maxBufferSize: 2 * 1024 * 1024,
  })
  // Advertise no roots, sampling, elicitation or other unimplemented client capabilities.
  const client = new Client({ name: 'ramu-shared-mcp', version: '0.1.0' }, { capabilities: {} })
  try {
    await client.connect(transport, { signal, timeout: 60_000 })
    signal.throwIfAborted()
    return client
  } catch {
    await client.close().catch(() => {})
    throw new Error('The local MCP server could not start or complete its handshake')
  }
}
