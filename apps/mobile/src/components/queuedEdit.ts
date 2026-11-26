import { useEffect, useRef, useState } from 'react'
import type { QueuedMessage } from '@ramu/shared/types'
import { replaceVisibleMessage, visibleMessage } from '@ramu/shared/chat/visibleMessage'

/** Opens a queued message or waiting steer in the message box; the host holds it there until it is saved or cancelled. */
export interface QueuedEdit {
  hold: (id: string, held: boolean) => void
  open: (message: QueuedMessage) => void
  /** The message open in the message box, if any. */
  editingId: string | null
}

/**
 * Editing a queued message in the message box rather than in its row. The box switches to a draft of its own, so what
 * was being typed waits under the chat's usual draft and comes back after; the host holds the message meanwhile, so
 * it neither goes out half-changed nor loses its place.
 */
export function useQueuedEdit({
  draftKey,
  queue,
  setDraft,
  hold,
  save,
}: {
  draftKey: string
  queue: QueuedMessage[]
  setDraft: (key: string, text: string) => void
  hold: (id: string, held: boolean) => void
  save: (id: string, text: string) => void
}) {
  const [edit, setEdit] = useState<{ id: string; raw: string; kind: 'queued' | 'steer' } | null>(null)
  const key = `${draftKey}:queued`
  const latest = useRef({ edit, hold })
  latest.current = { edit, hold }

  const close = () => {
    setEdit(null)
    setDraft(key, '')
  }
  const open = (message: QueuedMessage) => {
    if (edit && edit.id !== message.id) hold(edit.id, false)
    setDraft(key, visibleMessage(message.text))
    setEdit({ id: message.id, raw: message.text, kind: message.mode === 'steer' ? 'steer' : 'queued' })
    if (!message.held) hold(message.id, true)
  }
  const cancel = () => {
    if (edit) hold(edit.id, false)
    close()
  }
  /**
   * Saves the box's text into the message; unchanged text only releases it. Always false, the composer's "keep the
   * draft": closing the edit switches the box back to the chat's own draft, which clearing it would wipe instead.
   */
  const submit = (text: string): false => {
    const next = text.trim()
    if (!edit || !next) return false
    if (next === visibleMessage(edit.raw).trim()) hold(edit.id, false)
    else save(edit.id, replaceVisibleMessage(edit.raw, next))
    close()
    return false
  }

  // A message that left the queue while open (sent, or removed on another device) ends the edit.
  const gone = !!edit && !queue.some((message) => message.id === edit.id)
  useEffect(() => {
    if (gone) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the message leaves; `close` only writes state
  }, [gone])
  // Leaving the chat mid-edit lets the message go out at its usual moment.
  useEffect(
    () => () => {
      const { edit: open, hold: release } = latest.current
      if (open) release(open.id, false)
    },
    [],
  )

  return {
    edit: edit && { id: edit.id, kind: edit.kind },
    draftKey: edit ? key : draftKey,
    open,
    cancel,
    submit,
  }
}
