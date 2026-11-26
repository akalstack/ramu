import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueuedMessage } from '@ramu/shared/types'
import { replaceVisibleMessage } from '@ramu/shared/chat/visibleMessage'
import { visibleText } from '../lib/messages'
import { useHost } from '../../../workspace/HostProvider'

type Act = (fn: () => Promise<unknown>) => Promise<void>

export interface QueuedEdit {
  id: string
  kind: 'queued' | 'steer'
}

/**
 * Editing a queued message or a waiting steer in the message box. The message is held on the host while it is edited,
 * so it neither goes out half-changed nor loses its place; what was being typed is put aside and comes back after.
 */
export function useQueuedEdit({
  sessionId,
  queued,
  draft,
  setDraft,
  act,
  focus,
}: {
  sessionId: string
  queued: QueuedMessage[]
  draft: string
  setDraft: (text: string) => void
  act: Act
  focus: (caret: number) => void
}) {
  const { invoke } = useHost()
  const [edit, setEdit] = useState<(QueuedEdit & { raw: string; aside: string }) | null>(null)
  const latest = useRef(edit)
  latest.current = edit

  const release = useCallback(
    (id: string) => void invoke('agent.holdQueued', sessionId, id, false).catch(() => {}),
    [invoke, sessionId],
  )

  const start = (message: QueuedMessage, kind: QueuedEdit['kind']) => {
    if (latest.current) release(latest.current.id)
    const text = visibleText(message.text)
    setEdit({ id: message.id, kind, raw: message.text, aside: latest.current ? latest.current.aside : draft })
    setDraft(text)
    if (!message.held) void act(() => invoke('agent.holdQueued', sessionId, message.id, true))
    requestAnimationFrame(() => focus(text.length))
  }

  const finish = () => {
    const current = latest.current
    if (!current) return
    setEdit(null)
    setDraft(current.aside)
    release(current.id)
  }

  /** Saves the box's text into the message; false when there was nothing being edited, so the caller sends as usual. */
  const save = (): boolean => {
    const current = latest.current
    if (!current) return false
    const next = draft.trim()
    if (!next) return true
    setEdit(null)
    setDraft(current.aside)
    if (next === visibleText(current.raw).trim()) release(current.id)
    else void act(() => invoke('agent.editQueued', sessionId, current.id, replaceVisibleMessage(current.raw, next)))
    return true
  }

  // A message that left the queue while being edited (removed on another device, or sent) ends the edit.
  const gone = !!edit && !queued.some((message) => message.id === edit.id)
  useEffect(() => {
    if (!gone) return
    const current = latest.current
    if (!current) return
    setEdit(null)
    setDraft(current.aside)
  }, [gone, setDraft])

  // Leaving the chat mid-edit lets the message go out at its usual moment.
  useEffect(() => () => void (latest.current && release(latest.current.id)), [release])

  return { edit: edit && { id: edit.id, kind: edit.kind }, start, cancel: finish, save }
}
