import { useCallback, useEffect, useState } from 'react'
import type { ChangeReview } from '../../shared/types'
import { invoke, ramu } from './ipc'
import { useWorkspace } from './workspace'
import { notifyError } from './Notifications'

export interface ReviewTarget { id: string; taskId?: string; fileId?: string; threadId?: string }
export function openReview(ws: ReturnType<typeof useWorkspace>, target: ReviewTarget) {
  const open = (taskId: string) => {
    ws.openTask(taskId)
    ws.openView(taskId, { kind: 'review', taskId, reviewId: target.id, fileId: target.fileId, threadId: target.threadId, requestId: crypto.randomUUID() })
  }
  if (target.taskId) open(target.taskId)
  else void invoke('reviews.get', target.id).then((review) => open(review.taskId), (error) => notifyError(String(error), 'Changes'))
}
export function useReviews() {
  const [loaded, setLoaded] = useState(false)
  const [reviews, setReviews] = useState<ChangeReview[]>([]), [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => invoke('reviews.list').then((r) => { setReviews(r); setLoaded(true); setError(null) }, (e) => setError(String(e))), [])
  useEffect(() => { void reload(); return ramu.on('automation:changed', () => { void reload() }) }, [reload])
  return { reviews, reload, error, loaded }
}
