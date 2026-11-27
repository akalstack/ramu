import { ArrowUp, ShieldQuestion } from 'lucide-react'
import { answerPairs } from '@ramu/shared/chat/questions'
import { ChatActivityButton } from '../../../chat/ChatActivity'
import { t as translate } from '../../../i18n'
import { CARET_CLASS } from '../styles'

/**
 * A sent answer: one line that leads back to the question's card, with each question and the answer given under it, so
 * the thread reads what was decided without scrolling up. Long ones are cut short; the card holds them in full.
 */
export function AnsweredNote({ requestId, body }: { requestId: string; body: string }) {
  const pairs = answerPairs(body)
  return (
    <div className="flex max-w-[86%] flex-col items-end gap-1 self-end">
      <ChatActivityButton type="button" title={translate('Show the question')} onClick={() => showQuestion(requestId)}>
        <ShieldQuestion size={13} />
        <span>
          {pairs.length === 1
            ? translate('Answered 1 question')
            : translate('Answered {0} questions', { 0: pairs.length })}
        </span>
        <ArrowUp size={13} className={CARET_CLASS} />
      </ChatActivityButton>
      {pairs.map((pair, index) => (
        <div key={index} className="flex max-w-full flex-col items-end text-right text-caption leading-[1.45]">
          {pair.question && (
            <span className="max-w-full truncate text-muted-foreground">{pair.question.replace(/\*\*|__|`/g, '')}</span>
          )}
          <span className="line-clamp-2 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]">{pair.answer}</span>
        </div>
      ))}
    </div>
  )
}

/** Brings a question's card into view and marks it for a moment, so the eye lands on it. */
function showQuestion(requestId: string) {
  const card = document.querySelector<HTMLElement>(`[data-question-request="${CSS.escape(requestId)}"]`)
  if (!card) return
  card.scrollIntoView({ block: 'center', behavior: 'smooth' })
  card.animate([{ boxShadow: '0 0 0 2px var(--primary)' }, { boxShadow: '0 0 0 2px transparent' }], {
    duration: 1400,
    easing: 'ease-out',
  })
}
