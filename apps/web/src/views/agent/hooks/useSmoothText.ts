import { useEffect, useState } from 'react'
import { reducedMotion } from '../../../workspace/panelMotion'
import { nextReveal } from '../lib/smoothText'

// A message already this long when it first appears in a chat just opened (mid-stream) shows what it has and writes the
// rest. One that arrives while the chat is open writes out from its first word, since providers often send a whole
// paragraph, or the whole reply, in one piece.
const SETTLED_CHARS = 160
const STEP_MS = 32

/**
 * The part of a streaming reply to show now: arrivals are written out frame by frame at a pace that follows the
 * backlog, so bursts from the provider read as steady writing. Finished text, and reduced motion, show at once.
 */
export function useSmoothText(text: string, streaming: boolean, fresh = false): string {
  const [shown, setShown] = useState(() => (!streaming || (!fresh && text.length > SETTLED_CHARS) ? text.length : 0))
  const behind = shown < text.length
  // Restarted as text arrives, so each frame paces against everything that has arrived so far.
  useEffect(() => {
    if (!behind) return
    if (reducedMotion()) {
      setShown(text.length)
      return
    }
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      // Each step parses the reply's Markdown again, so about thirty a second: smooth to read, light on long replies.
      if (now - last >= STEP_MS) {
        const elapsed = Math.min(100, now - last)
        last = now
        setShown((current) => nextReveal(text, Math.min(current, text.length), elapsed))
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [behind, text])
  return shown >= text.length ? text : text.slice(0, shown)
}
