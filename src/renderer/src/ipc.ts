import type { RamuMethods } from '../../shared/api'
import { queryClient, ipcQueryKey, isDataQuery, invalidateData } from './dataQueries'

export const ramu = window.ramu
export const invoke: typeof ramu.invoke = <M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>) => {
  const call = () => ramu.invoke(method, ...args)
  if (isDataQuery(method)) return queryClient.fetchQuery({ queryKey: ipcQueryKey(method, ...args), queryFn: call })
  return call().finally(() => {
    const domain = method.split('.')[0]!
    if (!['term', 'editor', 'clipboard', 'attachments'].includes(domain)) void invalidateData(domain, ...(domain === 'git' ? ['files'] : []))
  })
}

/** The renderer has no clipboard permission, so copying goes through the main process. */
export const copyText = (text: string) => invoke('clipboard.write', text)
