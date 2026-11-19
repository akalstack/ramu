import { afterEach, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import { connectSharedMcpStdio } from '../src/mcp/stdio'

afterEach(() => vi.unstubAllEnvs())
const fixture = fileURLToPath(new URL('./fixtures/shared-mcp.mjs', import.meta.url))
const connection: SharedMcpConnection = {
  id: 'connection',
  hostId: 'host',
  name: 'Local service',
  serviceAccountId: 'alice',
  revision: '1',
  enabled: true,
  scope: { projectIds: ['project'], hostWide: false },
  providers: ['codex'],
  transport: {
    type: 'stdio',
    command: process.execPath,
    args: [fixture, '$(echo do-not-execute)'],
    cwd: dirname(fixture),
    envSecretRefs: {},
  },
}

it('runs a real stdio handshake without a shell or inherited provider/unrelated secrets', async () => {
  vi.stubEnv('RAMU_MCP_TOKEN', 'provider-token')
  vi.stubEnv('SHARED_MCP_TEST_PRIVATE', 'unrelated-secret')
  const client = await connectSharedMcpStdio(connection, AbortSignal.timeout(10_000))
  try {
    expect((await client.listTools()).tools[0]?.name).toBe('inspect_environment')
    const result = await client.callTool({ name: 'inspect_environment', arguments: {} })
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          cwd: dirname(fixture),
          argument: '$(echo do-not-execute)',
          providerTokenPresent: false,
          unrelatedSecretPresent: false,
        }),
      },
    ])
  } finally {
    await client.close()
  }
})

it('resolves only explicit secret references bound to host, connection and service account', async () => {
  const local = {
    ...connection,
    transport: { ...connection.transport, envSecretRefs: { SERVICE_TEST_KEY: 'secret-ref' } },
  } as SharedMcpConnection
  const read = vi.fn(async () => 'test-service-key')
  const client = await connectSharedMcpStdio(local, AbortSignal.timeout(10_000), { read })
  try {
    expect(read).toHaveBeenCalledExactlyOnceWith({
      hostId: 'host',
      connectionId: 'connection',
      serviceAccountId: 'alice',
      reference: 'secret-ref',
    })
    const result = await client.callTool({ name: 'inspect_environment', arguments: {} })
    expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining('test-service-key') })])
  } finally {
    await client.close()
  }
})

it('fails closed when the secure store is missing or locked, without launching the command', async () => {
  const local = {
    ...connection,
    transport: { ...connection.transport, envSecretRefs: { SERVICE_TEST_KEY: 'secret-ref' } },
  } as SharedMcpConnection
  await expect(connectSharedMcpStdio(local, AbortSignal.timeout(10_000))).rejects.toThrow(
    'secure host credential store',
  )
  await expect(
    connectSharedMcpStdio(local, AbortSignal.timeout(10_000), {
      read: async () => {
        throw new Error('Store locked')
      },
    }),
  ).rejects.toThrow('unavailable or locked')
})

it.each(['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'RAMU_MCP_TOKEN', 'CODEX_HOME'])(
  'rejects process control variable %s',
  async (name) => {
    const local = {
      ...connection,
      transport: { ...connection.transport, envSecretRefs: { [name]: 'ref' } },
    } as SharedMcpConnection
    const read = vi.fn(async () => 'secret')
    await expect(connectSharedMcpStdio(local, AbortSignal.timeout(10_000), { read })).rejects.toThrow('not supported')
    expect(read).not.toHaveBeenCalled()
  },
)

it('does not launch a cancelled connection', async () => {
  await expect(connectSharedMcpStdio(connection, AbortSignal.abort())).rejects.toThrow()
})
