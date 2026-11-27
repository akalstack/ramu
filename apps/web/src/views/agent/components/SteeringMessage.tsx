import { useSentRise } from '../../../chat/ChatMotion'
import { Pencil, Trash2 } from 'lucide-react'
import { Message, MessageContent } from '@/components/ui/message'
import { Button } from '@/components/desktop-button'
import type { QueuedMessage } from '@ramu/shared/types'
import { Attachments } from '../../../composer/Attachments'
import { useHost } from '../../../workspace/HostProvider'
import { t as translate } from '../../../i18n'
import { visibleText } from '../lib/messages'
import { answerPairs, parseAnswerMessage } from '@ramu/shared/chat/questions'
import { AnsweredNote, UserBubble } from './UserMessage'
import { ICON_BUTTON_CLASS } from '../styles'

type Act = (fn: () => Promise<unknown>) => Promise<void>

/**
 * A steer waiting for the running turn, shown after the latest tool call. It joins the transcript as a sent message once
 * the turn takes it. Editing opens it in the message box and holds it on the host until the edit is saved or cancelled.
 */
export function SteeringMessage({
  sessionId,
  message,
  readOnly,
  editing,
  act,
  onEdit,
  onRemoved,
}: {
  sessionId: string
  message: QueuedMessage
  readOnly: boolean
  /** Open in the message box, held on the host until it is saved or cancelled. */
  editing: boolean
  act: Act
  onEdit: () => void
  /** The person removed it: it leaves at once instead of waiting for its message to show in the transcript. */
  onRemoved?: () => void
}) {
  const { invoke } = useHost()
  // An answer on its way to the agent reads as it will once sent: one line leading to the question's card, not the
  // delivery note the agent reads. It is not the person's to edit, and removing it would leave the card answered
  // with the agent never told.
  const answers = parseAnswerMessage(message.text)
  const text = answers ? '' : visibleText(message.text)
  // The copy shown while sending began rising from the message box; this row takes its place a moment later and
  // carries the rise on, instead of snapping the bubble to rest.
  const rise = useSentRise<HTMLDivElement>(false)
  const remove = () => {
    onRemoved?.()
    void act(() => invoke('agent.removeQueued', sessionId, message.id))
  }
  return (
    // Spaced and sized as the sent message it becomes, so the bubble stays put when the turn takes it.
    <Message align="end" className="mt-3.5" aria-busy="true">
      <MessageContent ref={rise} className="group max-w-[86%] origin-bottom-right items-end gap-1">
        {message.attachments?.length ? <Attachments files={message.attachments} /> : null}
        {answers && <AnsweredNote requestId={answers.requestId} count={answerPairs(answers.body).length} />}
        {text && <UserBubble>{text}</UserBubble>}
        <div className="flex items-center gap-1 text-caption text-muted-foreground">
          <span className={editing ? 'text-primary' : undefined}>
            {editing
              ? translate('Editing in the message box')
              : message.held
                ? translate('Held while editing')
                : translate('Steering · sends after the current tool call')}
          </span>
          {!readOnly && !editing && !answers && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={translate('Edit steering message')}
                title={translate('Edit')}
                onClick={onEdit}
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
      </MessageContent>
    </Message>
  )
}
