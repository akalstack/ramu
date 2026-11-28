import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { AgentEvent, AgentSessionInfo, Attachment } from '@ramu/shared/types'
import { ipcQueryKeyOn, queryClient } from '../../../dataQueries'
import { registerWorkspaceCheckpoint } from '../../../workspace/workspaceCheckpoint'
import { useHost } from '../../../workspace/HostProvider'
import { ownHostId } from '../../../hosts'
import type { TranscriptAnchor } from '../lib/transcriptRows'

// Per-chat presentation state belongs to the UI, separate from the data query cache.
const chatPresentation = new Map<
  string,
  { draft: string; attachments: Attachment[]; stick: boolean; anchor: TranscriptAnchor | undefined }
>()

/** What a chat looked like when it was last left open: draft, attachments and where the transcript was read. */
export const savedChat = (sessionId: string, host = ownHostId()) =>
  chatPresentation.get(JSON.stringify([host, sessionId]))

/**
 * When the chat unmounts, remembers its draft, attachments and reading position and refreshes its query cache; the
 * transcript reopens from that position (a chat left at the bottom at the bottom, one left higher up where it was).
 * The workspace checkpoint waits for no pending attachments.
 */
export function useChatPresentation({
  sessionId,
  session,
  events,
  draft,
  attachments,
  stick,
  anchor,
}: {
  sessionId: string
  session: AgentSessionInfo | null
  events: AgentEvent[]
  draft: string
  attachments: Attachment[]
  stick: RefObject<boolean>
  anchor: RefObject<TranscriptAnchor | undefined>
}) {
  const latestChat = useRef({ session, events, draft, attachments })
  latestChat.current = { session, events, draft, attachments }
  const host = useHost().id
  useEffect(() => registerWorkspaceCheckpoint(async () => latestChat.current.attachments.length === 0, host), [host])
  useLayoutEffect(() => {
    return () => {
      const current = latestChat.current
      chatPresentation.set(JSON.stringify([host, sessionId]), {
        draft: current.draft,
        attachments: current.attachments,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
        stick: stick.current,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
        anchor: anchor.current,
      })
      // Refresh cache lifetime on leaving an open chat, even if it was idle for
      // longer than the query's normal garbage-collection interval.
      if (current.session) queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.get', sessionId), current.session)
      queryClient.setQueryData(ipcQueryKeyOn(host, 'agent.events', sessionId), current.events)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [sessionId, host] by design; the values it reads beyond these are current as of that run
  }, [sessionId, host])
}
