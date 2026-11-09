import { useEffect, type RefObject } from 'react'
import { scrollMotion } from '../../../workspace/panelMotion'
import { useMessageScroller, useMessageScrollerScrollable } from '@/components/ui/message-scroller'

/** Hands the transcript scroller's `scrollToEnd` to the chat view, which sits above the scroller and cannot call the hook. */
export function TranscriptScrollApi({ apiRef }: { apiRef: RefObject<(() => void) | null> }) {
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => {
    apiRef.current = () => void scrollToEnd({ behavior: scrollMotion() })
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToEnd])
  return null
}

/**
 * Marks the viewport while the scroller follows new output (it reports no content past the end then), so CSS can make
 * those follow steps glide while an agent works. A reader who scrolled up is not following, and position restores stay
 * instant.
 */
export function TranscriptFollowState({ viewport }: { viewport: RefObject<HTMLDivElement | null> }) {
  const { end } = useMessageScrollerScrollable()
  useEffect(() => {
    viewport.current?.toggleAttribute('data-following', !end)
  }, [viewport, end])
  return null
}
