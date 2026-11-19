import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { AgentEvent, AgentSessionInfo, Attachment } from '@ramu/shared/types'
import { ipcQueryKeyOn, queryClient } from '../../../dataQueries'
import { registerWorkspaceCheckpoint } from '../../../workspace/workspaceCheckpoint'
import { useHost } from '../../../workspace/HostProvider'
import { ownHostId } from '../../../hosts'
import { releaseFollow } from './useTranscriptScroll'

// Per-chat presentation state belongs to the UI, separate from the data query cache.
const chatPresentation = new Map<string, { draft: string; attachments: Attachment[]; top: number; stick: boolean }>()

/** What a chat looked like when it was last left open: draft, attachments and scroll position. */
export const savedChat = (sessionId: string, host = ownHostId()) =>
  chatPresentation.get(JSON.stringify([host, sessionId]))

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
  const host = useHost().id
  useEffect(() => registerWorkspaceCheckpoint(async () => latestChat.current.attachments.length === 0, host), [host])
  useLayoutEffect(() => {
    const saved = chatPresentation.get(JSON.stringify([host, sessionId]))
    // A chat left at the bottom reopens at the bottom (the scroller does that); one left higher up goes back to where it was.
    if (saved && !saved.stick && scroller.current) {
      scroller.current.scrollTop = saved.top
      releaseFollow(scroller.current)
    }
    return () => {
      const current = latestChat.current
      chatPresentation.set(JSON.stringify([host, sessionId]), {
        draft: current.draft,
        attachments: current.attachments,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
        top: scroller.current?.scrollTop ?? 0,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
        stick: stick.current,
      })
      // Refresh cache lifetime on leaving an open chat, even if it was idle for
      // longer than the query's normal garbage-collection interval.
      if (current.session) queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.get', sessionId), current.session)
      queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.events', sessionId), current.events)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [sessionId, host] by design; the values it reads beyond these are current as of that run
  }, [sessionId, host])
}
