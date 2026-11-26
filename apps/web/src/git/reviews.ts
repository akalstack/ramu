import { useCallback, useSyncExternalStore } from 'react'
import { errorText } from '../lib/errors'
import type { ChangeReview } from '@ramu/shared/types'
import { invoke, invokerFor } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { useWorkspace } from '../workspace/workspace'
import { notifyError } from '../chat/Notifications'
import { createSharedResource } from '@ramu/shared/workspace/asyncResource'
import type { RamuBridge } from '@ramu/shared/api'

export interface ReviewTarget {
  id: string
  taskId?: string
  fileId?: string
  threadId?: string
}
/** `hostInvoke` is the host of `ws` (`useHost().invoke`); it is only needed when `target` has no `taskId`. */
export function openReview(
  ws: ReturnType<typeof useWorkspace>,
  target: ReviewTarget,
  hostInvoke: RamuBridge['invoke'] = invoke,
) {
  const open = (taskId: string) => {
    ws.openTask(taskId)
    ws.openView(taskId, {
      kind: 'review',
      taskId,
      reviewId: target.id,
      fileId: target.fileId,
      threadId: target.threadId,
      requestId: crypto.randomUUID(),
    })
  }
  if (target.taskId) open(target.taskId)
  else
    void hostInvoke('reviews.get', target.id).then(
      (review) => open(review.taskId),
      (error) => notifyError(errorText(error), 'Changes'),
    )
}
const resources = new Map<string, ReturnType<typeof createSharedResource<ChangeReview[]>>>()
/** One cached review list per host, following only that host's events. */
export function useReviews() {
  const host = useHost().id
  const { on } = useHostRuntime()
  let resource = resources.get(host)
  if (!resource) {
    resource = createSharedResource<ChangeReview[]>(() => invokerFor(host)('reviews.list'), [])
    resources.set(host, resource)
  }
  const summaries = resource
  const subscribe = useCallback(
    (listener: () => void) => {
      const changed = on('automation:changed', summaries.invalidate)
      const connection = on('background:connection', ({ connected, resumed }) => {
        if (connected && !resumed) summaries.invalidate()
      })
      const off = summaries.subscribe(listener)
      return () => {
        changed()
        connection()
        off()
      }
    },
    [on, summaries],
  )
  const snapshot = useSyncExternalStore(subscribe, summaries.getSnapshot)
  return { reviews: snapshot.value, loaded: snapshot.loaded, error: snapshot.error, reload: summaries.reload }
}
