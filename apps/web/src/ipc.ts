import { CancelledError } from '@tanstack/react-query'
import type { RamuMethods } from '@ramu/shared/api'
import { queryClient, ipcQueryKeyOn, isDataQuery, invalidateDataOn } from './dataQueries'
import { ownHostId } from './hosts'
import { ownHostOnly } from './workspace/hostEvents'

/** The preload bridge as is, with every host's events. Only host-aware code reads it (the host event router). */
export const bridge = window.ramu
/**
 * The bridge for this window's own host: `on` drops events of the other hosts this window shows, so a listener that
 * knows no host never acts on another host's event. Code below a host's store listens with `useHostRuntime().on`.
 */
export const ramu = ownHostOnly(bridge, ownHostId)

/**
 * A hook refetching the same key (the Source Control panel does) cancels reads already in flight. The caller never
 * asked to cancel, so it joins the newer fetch instead of failing.
 */
async function read<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await queryClient.fetchQuery({ queryKey, queryFn })
    } catch (error) {
      if (!(error instanceof CancelledError) || attempt >= 4) throw error
    }
  }
}
type Invoke = typeof ramu.invoke
/**
 * A call on one host. The window's own host goes through `ramu.invoke` exactly as before; any other host goes through
 * `ramu.invokeOn`, which the desktop shell routes (and allow-lists) by host id. Reads are cached per host.
 */
function callOn<M extends keyof RamuMethods>(host: string, method: M, args: Parameters<RamuMethods[M]>) {
  const call = () => (host === ownHostId() ? ramu.invoke(method, ...args) : ramu.invokeOn(host, method, ...args))
  if (isDataQuery(method)) return read(ipcQueryKeyOn(host, method, ...args), call)
  return call().finally(() => {
    const domain = method.split('.')[0]!
    if (!['term', 'editor', 'clipboard', 'attachments'].includes(domain))
      void invalidateDataOn(host, domain, ...(domain === 'git' ? ['files'] : []))
  })
}
export const invoke: Invoke = (method, ...args) => callOn(ownHostId(), method, args)
export const invokeOn = <M extends keyof RamuMethods>(host: string, method: M, ...args: Parameters<RamuMethods[M]>) =>
  callOn(host, method, args)

const bound = new Map<string, Invoke>()
/** `invoke` bound to one host, stable per host id so it is safe in dependency lists. */
export function invokerFor(host: string): Invoke {
  if (host === ownHostId()) return invoke
  let invoker = bound.get(host)
  if (!invoker) {
    invoker = (method, ...args) => callOn(host, method, args)
    bound.set(host, invoker)
  }
  return invoker
}

/** The renderer has no clipboard permission, so copying goes through the main process. */
export const copyText = (text: string) => invoke('clipboard.write', text)
