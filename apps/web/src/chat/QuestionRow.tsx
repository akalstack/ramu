import { t, useLanguage } from '../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { questionKey, questionAnswer, type QuestionRequest, type QuestionState } from '@ramu/shared/chat/questions'

export function QuestionRow({
  request,
  status,
  pending,
  onOpen,
}: {
  request: QuestionRequest
  status: QuestionState
  pending: boolean
  onOpen?: (requestId: string) => void
}) {
  useLanguage()
  const summary = request.dependsOn || request.questions[0]?.question
  const count =
    request.questions.length === 1 ? t('Asked a question') : t('Asked {0} questions', { '0': request.questions.length })
  if (pending)
    return (
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover question-row [&:is(button).pending]:flex-row [&:is(button).pending]:items-center [&:is(button).pending]:gap-2 [&:is(button).pending]:w-full [&:is(button).pending]:h-auto [&:is(button).pending]:bg-raised [&:is(button).pending]:text-foreground [&:is(button).pending]:font-normal [&:is(button).pending]:text-left [&:is(button).pending]:whitespace-normal [&:is(button).pending:hover]:bg-fill-hover focus:outline-none focus-visible:bg-fill-hover focus:ring-0 focus:[border-color:transparent] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex flex-col gap-1.5 m-[8px_0] p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) text-control bg-fill pending"
        data-question-request={request.requestId}
        onClick={() => onOpen?.(request.requestId)}
      >
        <ShieldQuestion size={13} />
        <span className="question-row-text flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <strong>{count}</strong>
          <span className="muted text-muted-foreground"> · {summary}</span>
        </span>
        <span className="question-row-state flex-none text-warn text-caption">{t('Waiting for your answer')}</span>
        <ChevronRight
          size={13}
          className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
        />
      </Button>
    )
  const outcome =
    status.outcome === 'obsolete'
      ? t('No longer needed')
      : status.outcome === 'dismissed'
        ? t('Dismissed')
        : status.outcome === 'answered'
          ? t('Answered')
          : t('Cancelled')
  return (
    <div
      className="question-row [&:is(button).pending]:flex-row [&:is(button).pending]:items-center [&:is(button).pending]:gap-2 [&:is(button).pending]:w-full [&:is(button).pending]:h-auto [&:is(button).pending]:bg-raised [&:is(button).pending]:text-foreground [&:is(button).pending]:font-normal [&:is(button).pending]:text-left [&:is(button).pending]:whitespace-normal [&:is(button).pending:hover]:[border-color:var(--line-strong)] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex flex-col gap-1.5 m-[8px_0] p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) text-control bg-fill"
      data-question-request={request.requestId}
    >
      <div className="question-row-head [&_>_svg]:text-muted-foreground flex items-center gap-1.5">
        <ShieldQuestion size={13} />
        <strong>{count}</strong>
        <span className="muted text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="muted text-muted-foreground">
          {outcome}
          {status.reason ? `: ${status.reason}` : ''}
        </span>
      </div>
      <dl className="question-row-answers flex flex-col gap-3 m-0">
        {request.questions.map((q) => {
          const answer = questionAnswer(status.answers, questionKey(q))
          const selected = new Set(answer ? (q.multiSelect ? answer.split(', ') : [answer]) : [])
          return (
            <Collapsible key={questionKey(q)} className="flex flex-col gap-1.5 min-w-0">
              <dt className="text-soft">
                {q.options.length > 0 ? (
                  <CollapsibleTrigger
                    render={<Button variant="ghost" />}
                    className="flex items-start justify-between gap-2 -mx-2 w-[calc(100%+16px)] h-auto px-2 py-1 text-left whitespace-normal font-normal"
                  >
                    <span>{q.question}</span>
                    <ChevronRight className="mt-0.5 flex-none text-muted-foreground [[data-open]_>_&]:rotate-90" />
                  </CollapsibleTrigger>
                ) : (
                  q.question
                )}
              </dt>
              <dd className="flex flex-col gap-2 m-0">
                {q.options.length > 0 && (
                  <CollapsibleContent>
                    <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
                      {q.options.map((option) => (
                        <li key={option.label}>
                          <label className="flex items-start gap-2">
                            <input
                              type={q.multiSelect ? 'checkbox' : 'radio'}
                              checked={selected.has(option.label)}
                              disabled
                              readOnly
                              className="flex-none mt-0.5"
                            />
                            <span className={selected.has(option.label) ? 'text-foreground' : 'text-muted-foreground'}>
                              {option.label}
                              {option.description && (
                                <span className="block text-caption text-muted-foreground">{option.description}</span>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                )}
                {answer ? (
                  <div className="flex flex-col gap-1 mt-1 rounded-(--radius-s) bg-raised px-3 py-2">
                    <span className="text-caption text-muted-foreground">{t('Answer')}</span>
                    <p className="m-0 whitespace-pre-wrap wrap-anywhere font-semibold text-foreground">{answer}</p>
                  </div>
                ) : (
                  <p className="m-0 text-muted-foreground">{t('No answer')}</p>
                )}
              </dd>
            </Collapsible>
          )
        })}
      </dl>
    </div>
  )
}
