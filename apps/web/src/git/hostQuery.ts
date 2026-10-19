import type { RamuBridge } from '@ramu/shared/api'
import { ownHostId } from '../hosts'
import { ramu } from '../ipc'

/**
 * An uncached call on `host`, for react-query `queryFn`s whose key already names the host (`ipcQueryKeyOn`). The
 * cached `useHost().invoke` would wait on the very query it runs inside, so these go to the bridge directly.
 */
export const queryInvokerFor = (host: string): RamuBridge['invoke'] =>
  host === ownHostId() ? ramu.invoke : (method, ...args) => ramu.invokeOn(host, method, ...args)
