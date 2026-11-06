import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import type { AgentEvent } from '@ramu/shared/types'
import type { QuestionState } from '@ramu/shared/chat/questions'
import { GHOST_TEXT_BUTTON_CLASS } from '../styles'

type PendingQuestion = Extract<AgentEvent, { kind: 'question' | 'elicitation' | 'secret-request' }>

/** The unanswered questions as chips above the transcript. A question opens its dock; an elicitation scrolls to its card. */
export function PendingQuestionsBar({
  questions,
  states,
  scroller,
  onOpenQuestion,
}: {
  questions: PendingQuestion[]
  states: Map<string, QuestionState>
  scroller: React.RefObject<HTMLDivElement | null>
  onOpenQuestion: (requestId: string) => void
}) {
  useLanguage()
  return (
    <div
      className="pending-questions [&_button]:whitespace-normal [&_button]:text-left flex flex-wrap gap-1 p-[6px_12px] [border-bottom:1px_solid_var(--line)] max-h-[130px] overflow-auto"
      aria-label={translate('Pending questions')}
    >
      {questions.map((question) => (
        <Button
          variant="ghost"
          size="sm"
          key={question.requestId}
          className={GHOST_TEXT_BUTTON_CLASS}
          onClick={() => {
            if (question.kind === 'question') return onOpenQuestion(question.requestId)
            const card = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-question-request]') ?? [])].find(
              (node) => node.dataset.questionRequest === question.requestId,
            )
            card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            card?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
          }}
        >
          {question.kind !== 'question' ||
          states.get(question.requestId)?.waiting ||
          question.responseMode !== 'message'
            ? 'Waiting: '
            : 'Pending: '}
          {question.kind === 'secret-request'
            ? question.label
            : question.kind === 'elicitation'
              ? `${question.serverName}: ${question.message}`
              : question.dependsOn || question.questions[0]?.question}
        </Button>
      ))}
    </div>
  )
}
