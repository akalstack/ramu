import { ArrowUp, CornerDownRight, ShieldQuestion } from 'lucide-react'
import { answerPairs } from '@ramu/shared/chat/questions'
import { ChatActivityButton } from '../../../chat/ChatActivity'
import { t as translate } from '../../../i18n'
import { CARET_CLASS } from '../styles'

/**
 * A sent answer, read like the agent's other activity: one line that leads back to the question's card, then each
 * question with the answer given under it, indented to that line's text, so the thread reads what was decided without
 * scrolling up. Long ones are cut short; the card holds them in full.
 */
export function AnsweredNote({ requestId, body }: { requestId: string; body: string }) {
  const pairs = answerPairs(body)
  return (
    <div className="flex max-w-full flex-col gap-1">
      <ChatActivityButton type="button" title={translate('Show the question')} onClick={() => showQuestion(requestId)}>
        <ShieldQuestion size={13} />
        <span>
          {pairs.length === 1
            ? translate('Answered 1 question')
            : translate('Answered {0} questions', { 0: pairs.length })}
        </span>
        <ArrowUp size={13} className={CARET_CLASS} />
      </ChatActivityButton>
      <div className="answered-pairs flex flex-col gap-2 pl-[22px] text-caption leading-[1.45]">
        {pairs.map((pair, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-0.5">
            {pair.question && (
              <span className="line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]">
                {pair.question.replace(/\*\*|__|`/g, '')}
              </span>
            )}
            <span className="flex min-w-0 items-start gap-1.5 text-foreground">
              <CornerDownRight size={12} className="mt-[3px] flex-none text-muted-foreground" aria-hidden />
              <span className="line-clamp-3 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{pair.answer}</span>
            </span>
          </div>
        ))}
      </div>
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
