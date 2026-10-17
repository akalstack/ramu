import { useEffect, useRef, useState, type RefObject } from 'react'
import { highlightSource } from '@ramu/shared/workspace/sourceNavigation'
import type { AgentEvent } from '@ramu/shared/types'
import type { ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { useWorkspaceActions } from '../../../workspace/workspace'
import { TURN_PAGE } from '../constants'
import { turnsToKeep } from '../lib/paging'
import type { AgentViewDesc, Turn } from '../types'

/**
 * A long chat draws its latest turns first; "Earlier turns" brings back the previous page (the scroller keeps the reader
 * where they were). A request to open a message from elsewhere (view.sourceSeq) scrolls to it, drawing every turn if needed.
 */
export function useTurnPaging({
  view,
  visible,
  taskId,
  events,
  blocks,
  turns,
  scroller,
  stick,
}: {
  view: AgentViewDesc
  visible: boolean
  taskId: string | undefined
  events: AgentEvent[]
  blocks: Block[]
  turns: Turn[]
  scroller: RefObject<HTMLDivElement | null>
  stick: RefObject<boolean>
}) {
  const ws = useWorkspaceActions()
  // A long chat draws its latest turns first; see "Earlier turns" below.
  const [shownTurns, setShownTurns] = useState(TURN_PAGE)
  const handledSource = useRef<string | null>(null)
  useEffect(() => {
    if (!visible || !view.sourceSeq || !events.length) return
    const request = view.sourceRequestId ?? `${view.sessionId}:${view.sourceSeq}`
    if (handledSource.current === request) return
    const source = events[view.sourceSeq - 1]
    const index = blocks.findIndex((b) =>
      b.kind === 'event'
        ? b.event === source
        : b.tools.some((t) => t === source || (source?.kind === 'tool-result' && t.toolUseId === source.toolUseId)),
    )
    const node = scroller.current?.querySelector(`[data-block-index="${index}"]`)
    // The message lives in a turn that is not drawn yet: bring every turn back, then this runs again.
    if (!node && index >= 0) {
      setShownTurns(Number.MAX_SAFE_INTEGER)
      return
    }
    if (node) {
      handledSource.current = request
      stick.current = false
      node.scrollIntoView({ block: 'center' })
      return highlightSource(node, () => {
        if (taskId) ws.consumeSourceNavigation(taskId, view.id, view.sourceRequestId)
      })
    }
  }, [view.sourceSeq, view.sourceRequestId, events.length, visible, taskId, shownTurns])
  // A long chat draws its latest turns first; "Earlier turns" brings back the previous page, keeping the reader where they were.
  const hiddenTurns = Math.max(0, turns.length - shownTurns)
  const pageTurns = hiddenTurns ? turns.slice(hiddenTurns) : turns
  useEffect(() => {
    setShownTurns(TURN_PAGE)
  }, [view.sessionId])
  // Newer turns push the oldest drawn one out of the page; a reader who scrolled up keeps it, so the text does not move away.
  const counted = useRef({ sessionId: view.sessionId, count: turns.length })
  useEffect(() => {
    const keep = turnsToKeep(counted.current, { sessionId: view.sessionId, count: turns.length }, stick.current)
    counted.current = { sessionId: view.sessionId, count: turns.length }
    if (keep > 0) setShownTurns((count) => count + keep)
  }, [turns.length, view.sessionId])
  // The scroller keeps the reader where they were while earlier turns are added above.
  const showEarlierTurns = () => {
    stick.current = false
    setShownTurns((count) => count + TURN_PAGE)
  }
  return { hiddenTurns, pageTurns, showEarlierTurns }
}
