import { useEffect, useRef, useState } from 'react'
import type { ChangeFile } from '@ramu/shared/types'
import { useNearViewport } from '../lib/useNearViewport'
import { estimatedDiffHeight } from '../git/ReviewDiff'

const revealListeners = new Map<string, Set<(event: CustomEvent) => void>>()
const revealFile = (event: Event) => {
  const request = event as CustomEvent
  if (!request.detail?.replayed) revealListeners.get(request.detail?.fileId)?.forEach((listener) => listener(request))
}
/** Keep visited cards (and their drafts) alive, but do not construct off-screen card bodies. */
export function DeferredReviewFile({
  file,
  visible,
  children,
}: {
  file: ChangeFile
  visible: boolean
  children: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null),
    near = useNearViewport(root, visible)
  const [visited, setVisited] = useState(false),
    [request, setRequest] = useState<CustomEvent | null>(null)
  useEffect(() => {
    if (near) setVisited(true)
  }, [near])
  useEffect(() => {
    if (!visible) return
    if (!revealListeners.size) {
      window.addEventListener('ramu:review-file', revealFile)
      window.addEventListener('ramu:review-line', revealFile)
    }
    const listeners = revealListeners.get(file.id) ?? new Set()
    const reveal = (event: CustomEvent) => {
      setVisited(true)
      setRequest(event)
    }
    listeners.add(reveal)
    revealListeners.set(file.id, listeners)
    return () => {
      listeners.delete(reveal)
      if (!listeners.size) revealListeners.delete(file.id)
      if (!revealListeners.size) {
        window.removeEventListener('ramu:review-file', revealFile)
        window.removeEventListener('ramu:review-line', revealFile)
      }
    }
  }, [file.id, visible])
  useEffect(() => {
    if (visited && request) {
      window.dispatchEvent(new CustomEvent(request.type, { detail: { ...request.detail, replayed: true } }))
      setRequest(null)
    }
  }, [visited, request])
  return (
    <div ref={root} data-file-id={file.id} className="review-file-slot min-w-0">
      {near || visited ? (
        children
      ) : (
        <div
          className="review-file-placeholder p-3 rounded-(--radius-m) bg-fill"
          // About the height the card will have, so reaching it does not move the files below.
          style={{ height: file.binary ? 100 : estimatedDiffHeight(file) + 44 }}
        >
          <span className="muted text-muted-foreground small text-caption">{file.path}</span>
        </div>
      )}
    </div>
  )
}
