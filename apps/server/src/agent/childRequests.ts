import { createHash } from 'node:crypto'
export interface ForwardedRequest {
  parentId: string
  childId: string
  requestId: string
}
/** Bounded IDs fit the RPC contract even when providers use long or duplicate request IDs. */
export function forwardedRequestId(parentId: string, childId: string, requestId: string): string {
  return `child-${createHash('sha256')
    .update(JSON.stringify([parentId, childId, requestId]))
    .digest('hex')
    .slice(0, 40)}`
}
