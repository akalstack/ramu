import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { AgentEvent, AgentSessionInfo, Attachment } from '@ramu/shared/types'
import { ipcQueryKey, queryClient } from '../../../dataQueries'
import { registerWorkspaceCheckpoint } from '../../../workspaceCheckpoint'

// Per-chat presentation state belongs to the UI, separate from the data query cache.
const chatPresentation = new Map<string, { draft: string; attachments: Attachment[]; top: number; stick: boolean }>()

/** What a chat looked like when it was last left open: draft, attachments and scroll position. */
export const savedChat = (sessionId: string) => chatPresentation.get(sessionId)

/**
 * Restores the saved scroll position and, when the chat unmounts, remembers its draft, attachments and
 * scroll position and refreshes its query cache. The workspace checkpoint waits for no pending attachments.
 */
export function useChatPresentation({
  sessionId,
  session,
  events,
  draft,
  attachments,
  scroller,
  stick,
}: {
  sessionId: string
  session: AgentSessionInfo | null
  events: AgentEvent[]
  draft: string
  attachments: Attachment[]
  scroller: RefObject<HTMLDivElement | null>
  stick: RefObject<boolean>
}) {
  const latestChat = useRef({ session, events, draft, attachments })
  latestChat.current = { session, events, draft, attachments }
  useEffect(() => registerWorkspaceCheckpoint(async () => latestChat.current.attachments.length === 0), [])
  useLayoutEffect(() => {
    const saved = chatPresentation.get(sessionId)
    if (saved && scroller.current) scroller.current.scrollTop = saved.top
    return () => {
      const current = latestChat.current
      chatPresentation.set(sessionId, {
        draft: current.draft,
        attachments: current.attachments,
        top: scroller.current?.scrollTop ?? 0,
        stick: stick.current,
      })
      // Refresh cache lifetime on leaving an open chat, even if it was idle for
      // longer than the query's normal garbage-collection interval.
      if (current.session) queryClient.setQueryData(ipcQueryKey('agent.get', sessionId), current.session)
      queryClient.setQueryData(ipcQueryKey('agent.events', sessionId), current.events)
    }
  }, [sessionId])
}
