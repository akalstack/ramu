// Ramu Link for Node clients: once an app registers its account, host addresses under `.link.invalid` are reached
// through sealed relay streams, and every other address as before.
import { linkFetch, linkSocketFactory, type LinkClientOptions } from '@ramu/shared/link/client'
import { nodeSocketFactory } from './nodeSocket'
import type { SocketFactory } from './socket'

let transport: { factory: SocketFactory; fetch: typeof fetch } | null = null

/** Registers (or with null removes) the account and pinned keys this process uses for Link addresses. */
export function useLinkTransport(options: LinkClientOptions | null) {
  transport = options
    ? { factory: linkSocketFactory(options, nodeSocketFactory), fetch: linkFetch(options, globalThis.fetch) }
    : null
}

/** The socket factory for a remote host. */
export const remoteSocketFactory: SocketFactory = (url, headers, handlers) =>
  (transport?.factory ?? nodeSocketFactory)(url, headers, handlers)

/** `fetch` for host addresses, Link-aware once a transport is registered. */
export const hostFetch: typeof fetch = (input, init) => (transport?.fetch ?? globalThis.fetch)(input, init)
