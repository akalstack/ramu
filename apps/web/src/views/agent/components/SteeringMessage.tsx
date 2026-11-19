import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/desktop-button'
import type { QueuedMessage } from '@ramu/shared/types'
import { replaceVisibleMessage } from '@ramu/shared/chat/visibleMessage'
import { Attachments } from '../../../composer/Attachments'
import { useHost } from '../../../workspace/HostProvider'
import { t as translate } from '../../../i18n'
import { visibleText } from '../lib/messages'
import { UserBubble } from './UserMessage'
import { ICON_BUTTON_CLASS } from '../styles'

type Act = (fn: () => Promise<unknown>) => Promise<void>

/**
 * A steer waiting for the running turn, shown after the latest tool call. It joins the transcript as a sent message once
 * the turn takes it. Editing holds it on the host, so it is not sent until the edit is saved or cancelled.
 */
export function SteeringMessage({
  sessionId,
  message,
  readOnly,
  act,
}: {
  sessionId: string
  message: QueuedMessage
  readOnly: boolean
  act: Act
}) {
  const { invoke } = useHost()
  const text = visibleText(message.text)
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null
  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    // Leaving the chat mid-edit releases the hold, so the steer is not stuck waiting for an editor that is gone.
    return () => void invoke('agent.holdQueued', sessionId, message.id, false).catch(() => {})
  }, [editing, invoke, sessionId, message.id])
  const startEdit = () => {
    setDraft(text)
    if (!message.held) void act(() => invoke('agent.holdQueued', sessionId, message.id, true))
  }
  // Closing the editor releases the hold through the effect above.
  const cancel = () => setDraft(null)
  const save = () => {
    const next = draft?.trim()
    if (!next) return
    // Unchanged text just releases the hold; a change goes out as a new steer, Ramu's own context kept.
    if (next === text) return cancel()
    setDraft(null)
    void act(() => invoke('agent.editQueued', sessionId, message.id, replaceVisibleMessage(message.text, next)))
  }
  const remove = () => void act(() => invoke('agent.removeQueued', sessionId, message.id))
  return (
    <Message align="end" aria-busy="true">
      <MessageContent className="group max-w-[78%] items-end gap-1">
        {message.attachments?.length ? <Attachments files={message.attachments} /> : null}
        {editing ? (
          <div className="flex w-full min-w-80 flex-col gap-2">
            <Textarea
              ref={input}
              value={draft}
              aria-label={translate('Edit steering message')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') cancel()
                else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  save()
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={cancel}>
                {translate('Cancel')}
              </Button>
              <Button size="sm" disabled={!draft.trim()} onClick={save}>
                {translate('Save')}
              </Button>
            </div>
          </div>
        ) : (
          text && <UserBubble>{text}</UserBubble>
        )}
        {!editing && (
          <div className="flex items-center gap-1 text-caption text-muted-foreground">
            <span>
              {message.held
                ? translate('Held while editing')
                : translate('Steering · sends after the current tool call')}
            </span>
            {!readOnly && (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={ICON_BUTTON_CLASS}
                  aria-label={translate('Edit steering message')}
                  title={translate('Edit')}
                  onClick={startEdit}
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={ICON_BUTTON_CLASS}
                  aria-label={translate('Remove steering message')}
                  title={translate('Remove')}
                  onClick={remove}
                >
                  <Trash2 size={13} />
                </Button>
              </>
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  )
}
