import { CancelledError } from '@tanstack/react-query'
import type { RamuMethods } from '@ramu/shared/api'
import { queryClient, ipcQueryKey, isDataQuery, invalidateData } from './dataQueries'

export const ramu = window.ramu

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
export const invoke: typeof ramu.invoke = <M extends keyof RamuMethods>(
  method: M,
  ...args: Parameters<RamuMethods[M]>
) => {
  const call = () => ramu.invoke(method, ...args)
  if (isDataQuery(method)) return read(ipcQueryKey(method, ...args), call)
  return call().finally(() => {
    const domain = method.split('.')[0]!
    if (!['term', 'editor', 'clipboard', 'attachments'].includes(domain))
      void invalidateData(domain, ...(domain === 'git' ? ['files'] : []))
  })
}

/** The renderer has no clipboard permission, so copying goes through the main process. */
export const copyText = (text: string) => invoke('clipboard.write', text)
