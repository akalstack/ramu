import type { RamuBridge } from '@ramu/shared/api'
import { invokeUncachedOn } from '../ipc'

/**
 * An uncached call on `host`, for react-query `queryFn`s whose key already names the host (`ipcQueryKeyOn`). The
 * cached `useHost().invoke` would wait on the very query it runs inside, so these go to the bridge directly.
 */
export const queryInvokerFor =
  (host: string): RamuBridge['invoke'] =>
  (method, ...args) =>
    invokeUncachedOn(host, method, ...args)
