import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { MessageCircle, Quote, SquarePen } from 'lucide-react'
import { formatKeys } from '../../../commands'
import { ICON_BUTTON_CLASS } from '../styles'

export type MessageAction = 'quote' | 'aside' | 'quote-new'
export const MESSAGE_ACTION_EVENT = 'ramu:message-action'
export interface MessageActionDetail {
  action: MessageAction
  text: string
  from: 'assistant' | 'user'
}

/**
 * The selection toolbar's actions for a whole message, beside Copy. They bubble a DOM event up to the chat that renders
 * the message (AgentView), so the memoized transcript rows need no callbacks.
 */
export function MessageQuoteActions({ text, from = 'assistant' }: { text: string; from?: 'assistant' | 'user' }) {
  useLanguage()
  const fire = (action: MessageAction) => (event: React.MouseEvent<HTMLElement>) =>
    event.currentTarget.dispatchEvent(
      new CustomEvent<MessageActionDetail>(MESSAGE_ACTION_EVENT, {
        bubbles: true,
        detail: { action, text: text.slice(0, 20_000), from },
      }),
    )
  const items = [
    { action: 'quote', icon: Quote, label: translate('Quote in your message'), keys: 'mod+shift+q' },
    { action: 'aside', icon: MessageCircle, label: translate('Ask aside about this message'), keys: 'mod+shift+a' },
    { action: 'quote-new', icon: SquarePen, label: translate('Quote in new thread') },
  ] as const
  return (
    <>
      {items.map(({ action, icon: Icon, label, ...item }) => (
        <Button
          key={action}
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON_CLASS} copy-btn`}
          aria-label={label}
          title={'keys' in item ? `${label} (${formatKeys(item.keys)})` : label}
          onClick={fire(action)}
        >
          <Icon />
        </Button>
      ))}
    </>
  )
}
