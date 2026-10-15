import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { highlightSource } from '@ramu/shared/sourceNavigation'
import type { AgentEvent } from '@ramu/shared/types'
import type { ChatBlock as Block } from '@ramu/shared/chatFolding'
import { useWorkspaceActions } from '../../../workspace'
import { TURN_PAGE } from '../constants'
import type { AgentViewDesc, Turn } from '../types'

/**
 * A long chat draws its latest turns first; "Earlier turns" brings back the previous page, keeping the reader
 * where they were. A request to open a message from elsewhere (view.sourceSeq) scrolls to it, drawing every turn if needed.
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
  measureEdges,
}: {
  view: AgentViewDesc
  visible: boolean
  taskId: string | undefined
  events: AgentEvent[]
  blocks: Block[]
  turns: Turn[]
  scroller: RefObject<HTMLDivElement | null>
  stick: RefObject<boolean>
  measureEdges: () => void
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
  const pageAnchor = useRef<{ height: number; top: number } | null>(null)
  useEffect(() => {
    setShownTurns(TURN_PAGE)
  }, [view.sessionId])
  useLayoutEffect(() => {
    const anchor = pageAnchor.current,
      el = scroller.current
    if (!anchor || !el) return
    pageAnchor.current = null
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
    measureEdges()
  }, [shownTurns])
  const showEarlierTurns = () => {
    const el = scroller.current
    if (el) {
      pageAnchor.current = { height: el.scrollHeight, top: el.scrollTop }
      stick.current = false
    }
    setShownTurns((count) => count + TURN_PAGE)
  }
  return { hiddenTurns, pageTurns, showEarlierTurns }
}
