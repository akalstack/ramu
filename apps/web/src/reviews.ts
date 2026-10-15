import { useSyncExternalStore } from 'react'
import { errorText } from './errors'
import type { ChangeReview } from '@ramu/shared/types'
import { invoke, ramu } from './ipc'
import { useWorkspace } from './workspace'
import { notifyError } from './Notifications'
import { createSharedResource } from '@ramu/shared/asyncResource'

export interface ReviewTarget {
  id: string
  taskId?: string
  fileId?: string
  threadId?: string
}
export function openReview(ws: ReturnType<typeof useWorkspace>, target: ReviewTarget) {
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
    void invoke('reviews.get', target.id).then(
      (review) => open(review.taskId),
      (error) => notifyError(errorText(error), 'Changes'),
    )
}
const summaries = createSharedResource<ChangeReview[]>(() => invoke('reviews.list'), [])
let subscriptions = 0
let unsubscribe: (() => void) | undefined
function subscribe(listener: () => void) {
  if (subscriptions++ === 0) {
    const changed = ramu.on('automation:changed', summaries.invalidate)
    const connection = ramu.on('background:connection', ({ connected }) => {
      if (connected) summaries.invalidate()
    })
    unsubscribe = () => {
      changed()
      connection()
    }
  }
  const off = summaries.subscribe(listener)
  return () => {
    off()
    if (--subscriptions === 0) {
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}
/** One cached summary list and one in-flight IPC request for every review consumer. */
export function useReviews() {
  const snapshot = useSyncExternalStore(subscribe, summaries.getSnapshot)
  return { reviews: snapshot.value, loaded: snapshot.loaded, error: snapshot.error, reload: summaries.reload }
}
