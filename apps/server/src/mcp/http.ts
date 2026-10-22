import { lookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent, fetch as request, type Dispatcher } from 'undici'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import type { HostSecretReader } from './stdio'
import { SharedMcpConnectionError } from './errors'
import { HostOAuthProvider, OAUTH_REFERENCE_NAME, type OAuthRecordStore, type StoredOAuth } from './oauth'

const privateV4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  privateV4.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const specialV6 = new BlockList()
specialV6.addSubnet('2001::', 23, 'ipv6')
specialV6.addSubnet('2001:db8::', 32, 'ipv6')
specialV6.addSubnet('2002::', 16, 'ipv6')

export function isPublicMcpAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? !privateV4.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !specialV6.check(address, 'ipv6')
}

/** The vetted DNS answers are the addresses actually used by the socket, avoiding a second DNS lookup/rebinding gap. */
export function sharedMcpLookup(allowPrivate: boolean, resolve = lookup): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        if (!addresses.length || (!allowPrivate && addresses.some((entry) => !isPublicMcpAddress(entry.address))))
          throw new Error('The server resolves to a private or unsupported network address')
        const selected = options.family ? addresses.filter((entry) => entry.family === options.family) : addresses
        if (!selected.length) throw new Error('No supported address for the MCP server')
        if (options.all) callback(null, selected)
        else callback(null, selected[0]!.address, selected[0]!.family)
      })
      .catch(() => callback(new Error('MCP server network access was denied or unavailable'), '', 0))
  }
}

/** Each upstream session gets its own TLS pool and exact-origin fetch boundary. */
export function sharedMcpHttpFetch(endpoint: string, allowPrivate = false, dispatcher?: Dispatcher, oauth = false) {
  const origin = new URL(endpoint)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash)
    throw new Error('Use an HTTPS MCP URL without credentials, query parameters or fragments')
  const literal = origin.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && !allowPrivate && !isPublicMcpAddress(literal))
    throw new Error('Private network access requires host approval')
  const agent =
    dispatcher ??
    new Agent({
      connections: 2,
      pipelining: 1,
      // Sign-in talks to the authorization server too; each origin still gets the same vetted-address lookup.
      maxOrigins: oauth ? 4 : 1,
      headersTimeout: 15_000,
      bodyTimeout: 60_000,
      connect: { lookup: sharedMcpLookup(allowPrivate), timeout: 15_000 },
    })
  const headerRecord = (headers: Headers) => {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input)
    const sameOrigin = url.origin === origin.origin
    if (
      (!sameOrigin && !(oauth && url.protocol === 'https:' && !isIP(url.hostname.replace(/^\[|\]$/g, '')))) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('Cross-origin MCP requests are not permitted')
    // Nothing meant for the MCP server (static headers, its bearer token) follows a request to another origin.
    const outgoing = new Headers(init.headers)
    if (!sameOrigin)
      for (const name of (() => {
        const names: string[] = []
        outgoing.forEach((_value, key) => names.push(key))
        return names
      })()) {
        const allowed =
          name === 'content-type' ||
          name === 'accept' ||
          (name === 'authorization' && /^Basic /i.test(outgoing.get(name) ?? ''))
        if (!allowed) outgoing.delete(name)
      }
    // No proxy or global dispatcher is used. Redirects, cookies and credential-bearing origin changes are never automatic.
    const response = await request(url, {
      method: init.method,
      headers: Object.fromEntries(outgoing as unknown as Iterable<[string, string]>),
      body: init.body as string | undefined,
      signal: init.signal,
      dispatcher: agent,
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('The MCP server redirected the request. Review and configure its final URL.')
    }
    const limit = 4 * 1024 * 1024
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body?.cancel()
      throw new Error('MCP response exceeds the supported size')
    }
    let bytes = 0
    const body =
      (response.body as ReadableStream<Uint8Array> | null)?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength
            if (bytes > limit) throw new Error('MCP response exceeds the supported size')
            controller.enqueue(chunk)
          },
        }) as never,
      ) ?? null
    return new Response(body as BodyInit | null, {
      status: response.status,
      statusText: response.statusText,
      headers: headerRecord(response.headers as unknown as Headers),
    })
  }
  return { fetch, close: () => agent.destroy() }
}

export async function connectSharedMcpHttp(
  connection: SharedMcpConnection,
  signal: AbortSignal,
  secrets?: HostSecretReader,
): Promise<Client> {
  if (connection.transport.type !== 'http') throw new Error('This connection needs a stdio MCP client')
  signal.throwIfAborted()
  const headers = new Headers()
  const oauthReference = connection.transport.headerSecretRefs[OAUTH_REFERENCE_NAME]
  const record = oauthReference
    ? {
        hostId: connection.hostId,
        connectionId: connection.id,
        serviceAccountId: connection.serviceAccountId,
        reference: oauthReference,
      }
    : undefined
  let authProvider: HostOAuthProvider | undefined
  if (record) {
    if (!secrets?.write) throw new Error('Set up a secure host credential store before using signed-in servers')
    const store = secrets
    const recordStore: OAuthRecordStore = {
      load: async () => JSON.parse(await store.read(record)) as StoredOAuth,
      save: (value) => store.write!(record, JSON.stringify(value)),
    }
    // Refresh needs stored tokens; with none, the person has to sign in again rather than a background retry.
    if (!(await recordStore.load()).tokens) throw new SharedMcpConnectionError('sign-in-required')
    authProvider = new HostOAuthProvider(recordStore)
  }
  for (const [name, reference] of Object.entries(connection.transport.headerSecretRefs)) {
    if (name === OAUTH_REFERENCE_NAME) continue
    if (
      /^(?:host|cookie|set-cookie|proxy-authorization|connection|content-length|origin|referer|accept|mcp-.*)$/i.test(
        name,
      )
    )
      throw new Error('This HTTP header is reserved by the MCP transport')
    if (!secrets) throw new Error('Set up a secure host credential store before using authenticated HTTP servers')
    const value = await secrets.read({
      hostId: connection.hostId,
      connectionId: connection.id,
      serviceAccountId: connection.serviceAccountId,
      reference,
    })
    headers.set(name, value)
    signal.throwIfAborted()
  }
  const network = sharedMcpHttpFetch(
    connection.transport.url,
    connection.transport.allowPrivateNetwork === true,
    undefined,
    authProvider !== undefined,
  )
  const transport = new StreamableHTTPClientTransport(new URL(connection.transport.url), {
    fetch: network.fetch,
    ...(authProvider ? { authProvider } : {}),
    requestInit: { headers, redirect: 'error' },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  })
  const client = new Client({ name: 'ramu-shared-mcp', version: '0.1.0' }, { capabilities: {} })
  const close = client.close.bind(client)
  client.close = async () => {
    try {
      await close()
    } finally {
      await network.close()
    }
  }
  try {
    await client.connect(transport, { signal, timeout: 60_000 })
    signal.throwIfAborted()
    return client
  } catch (error) {
    await client.close().catch(() => {})
    if (error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && error.code === 401))
      throw new SharedMcpConnectionError('sign-in-required')
    if (error instanceof StreamableHTTPError && error.code === 403)
      throw new SharedMcpConnectionError('insufficient-permission')
    // eslint-disable-next-line preserve-caught-error -- upstream causes may contain credentials
    throw new Error(
      'The remote MCP server could not complete its handshake. Check the URL, service sign-in and host network policy.',
    )
  }
}
