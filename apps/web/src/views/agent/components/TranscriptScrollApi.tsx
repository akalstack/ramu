import { useEffect, type RefObject } from 'react'
import { reducedMotion } from '../../../workspace/panelMotion'
import { useMessageScroller } from '@/components/ui/message-scroller'

/** Hands the transcript scroller's `scrollToEnd` to the chat view, which sits above the scroller and cannot call the hook. */
export function TranscriptScrollApi({ apiRef }: { apiRef: RefObject<(() => void) | null> }) {
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => {
    apiRef.current = () => void scrollToEnd({ behavior: reducedMotion() ? 'auto' : 'smooth' })
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToEnd])
  return null
}
