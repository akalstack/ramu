import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { t, useLanguage } from '../i18n'
import { Kbd } from '@/components/ui/kbd'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ShieldQuestion } from 'lucide-react'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { questionKey, questionAnswer, type QuestionRequest, type QuestionState } from '@ramu/shared/chat/questions'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'

const EMPTY: QuestionState = { answers: {}, drafts: {}, waiting: false }

/**
 * Questions waiting for the user are the first row of the tray the message box rests on, with goals and queued messages:
 * one question at a time, numbered options, and the transcript keeps a row where the agent asked.
 */
export function QuestionDock({
  sessionId,
  requests,
  states,
  open,
  onOpenChange,
  focus,
}: {
  sessionId: string
  requests: QuestionRequest[]
  states: Map<string, QuestionState>
  open: boolean
  onOpenChange: (open: boolean) => void
  focus: { requestId: string; at: number } | null
}) {
  useLanguage()
  const [currentId, setCurrentId] = useState<string | null>(null)
  useEffect(() => {
    if (focus) {
      setCurrentId(focus.requestId)
      onOpenChange(true)
    }
  }, [focus, onOpenChange])
  const index = Math.max(
    0,
    requests.findIndex((request) => request.requestId === currentId),
  )
  const request = requests[index]
  if (!request) return null
  const status = states.get(request.requestId) ?? EMPTY
  const blocking = request.responseMode !== 'message' || status.waiting
  const remaining = request.questions.filter((q) => !questionAnswer(status.answers, questionKey(q)))
  const pager = requests.length > 1 && (
    <span className="question-dock-pager inline-flex items-center gap-0.5 tabular-nums">
      <Button
        variant="ghost"
        size="icon-xs"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
        aria-label={t('Previous question')}
        disabled={index === 0}
        onClick={() => setCurrentId(requests[index - 1]!.requestId)}
      >
        <ChevronLeft size={13} />
      </Button>
      <span className="muted text-muted-foreground small text-caption">
        {index + 1}/{requests.length}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
        aria-label={t('Next question')}
        disabled={index === requests.length - 1}
        onClick={() => setCurrentId(requests[index + 1]!.requestId)}
      >
        <ChevronRight size={13} />
      </Button>
    </span>
  )
  return (
    <ComposerTraySection
      className={`question-dock${blocking ? ' blocking' : ''}`}
      role="region"
      aria-label={t('Questions from the agent')}
      open={open}
      onOpenChange={onOpenChange}
      icon={<ShieldQuestion />}
      title={
        blocking
          ? t('The agent is waiting for your answer')
          : t('{0} waiting for your answer', {
              '0': remaining.length === 1 ? t('1 question') : t('{0} questions', { '0': remaining.length }),
            })
      }
      actions={pager}
    >
      <QuestionForm
        key={request.requestId}
        sessionId={sessionId}
        request={request}
        status={status}
        focusAt={open && focus?.requestId === request.requestId ? focus.at : null}
      />
    </ComposerTraySection>
  )
}

function QuestionForm({
  sessionId,
  request,
  status,
  focusAt,
}: {
  sessionId: string
  request: QuestionRequest
  status: QuestionState
  focusAt: number | null
}) {
  useLanguage()
  const { invoke } = useHost()
  const [drafts, setDrafts] = useState<Record<string, string>>(status.drafts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const together = request.grouping !== 'independent'
  const questions = request.questions
  const firstOpen = Math.max(
    0,
    questions.findIndex((q) => !questionAnswer(status.answers, questionKey(q))),
  )
  const [page, setPage] = useState(firstOpen)
  const root = useRef<HTMLDivElement>(null)
  // Opened from the transcript: keys 1–9 pick an option right away. A question that just arrived does not take the caret.
  useEffect(() => {
    if (focusAt) root.current?.focus({ preventScroll: true })
  }, [focusAt])
  useEffect(() => {
    const timer = setTimeout(() => {
      void invoke('agent.questionDraft', sessionId, request.requestId, drafts).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [drafts, sessionId, request.requestId, invoke])
  const q = questions[Math.min(page, questions.length - 1)]!
  const key = questionKey(q)
  const answered = questionAnswer(status.answers, key)
  const value = answered ?? questionAnswer(drafts, key) ?? ''
  // An answer is either picked options or your own text, never both: the box only shows text you typed.
  const labels = new Set(q.options.map((option) => option.label))
  const picked = value ? (q.multiSelect ? value.split(', ') : [value]).filter((part) => labels.has(part)) : []
  const pickedOnly = picked.length > 0 && picked.length === (q.multiSelect ? value.split(', ').length : 1)
  const selected = new Set(pickedOnly ? picked : [])
  const typed = pickedOnly ? '' : value
  const unanswered = questions.filter((entry) => !questionAnswer(status.answers, questionKey(entry)))
  const filled = (entry: typeof q) => !!questionAnswer(drafts, questionKey(entry))?.trim()
  const last = page >= questions.length - 1
  const send = async (keys: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await invoke(
        'agent.replyQuestion',
        sessionId,
        request.requestId,
        Object.fromEntries(keys.map((k) => [k, questionAnswer(drafts, k) ?? ''])),
      )
      // A separate answer moves on to the next question still open.
      const next = questions.findIndex(
        (entry, index) =>
          index > page && !questionAnswer(status.answers, questionKey(entry)) && !keys.includes(questionKey(entry)),
      )
      if (!together && next >= 0) setPage(next)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('agent.dismissQuestion', sessionId, request.requestId)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  // Picking an option replaces typed text; with several allowed, it toggles among the picked options.
  const choose = (label: string) =>
    setDrafts((old) => {
      const current = q.multiSelect ? [...selected] : []
      return {
        ...old,
        [key]: q.multiSelect
          ? (current.includes(label) ? current.filter((v) => v !== label) : [...current, label]).join(', ')
          : label,
      }
    })
  const canSendAll = !busy && unanswered.every(filled)
  /** Enter moves on: next question, or send when everything this request needs is filled in. */
  const advance = () => {
    if (!together && !answered && value.trim()) return void send([key])
    if (!last) return setPage(page + 1)
    if (together && canSendAll) void send(unanswered.map(questionKey))
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const typing =
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLInputElement && event.target.type === 'text')
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      (typing || event.target === root.current)
    ) {
      event.preventDefault()
      advance()
      return
    }
    if (!typing && /^[1-9]$/.test(event.key) && !answered) {
      const option = q.options[Number(event.key) - 1]
      if (option) {
        event.preventDefault()
        choose(option.label)
      }
    }
  }
  return (
    <div
      ref={root}
      className="question-card question-dock-card"
      data-question-request={request.requestId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {questions.length > 1 && (
        <div className="question-dock-step text-caption text-muted-foreground tabular-nums">
          {t('Question {0} of {1}', { '0': page + 1, '1': questions.length })}
        </div>
      )}
      <div className="question-dock-body">
        {request.dependsOn && (
          <p className="small text-caption question-dock-needed m-0">
            <span className="muted text-muted-foreground">{t('Answer needed for: ')}</span>
            {request.dependsOn}
          </p>
        )}
        {questions.length > 1 && (
          <p className="muted text-muted-foreground small text-caption question-dock-note m-0">
            {together
              ? t('These questions are related. Send their answers together.')
              : t('Each answer can be sent separately.')}
          </p>
        )}
        <fieldset key={key} disabled={busy || !!answered}>
          <legend>{q.question}</legend>
          {q.options.length > 0 && (
            <div className="question-options grid gap-2">
              {q.options.map((option, index) => (
                <label
                  key={option.label}
                  className={`option [.question-card_&]:items-center [.question-card_&_input]:w-4 [.question-card_&_input]:h-4 [.question-card_&_input]:flex-none [.question-card_&_input]:p-0 [.question-card_&_input]:m-0 [.question-card_&_>_span]:min-w-0 [.elicitation-card_&]:flex [.elicitation-card_&]:items-center [.elicitation-card_&]:gap-2 [.elicitation-card_&]:m-[8px_0] p-[4px_0] ${selected.has(option.label) ? ' selected' : ''}`}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={`${request.requestId}:${key}`}
                    checked={selected.has(option.label)}
                    onChange={() => choose(option.label)}
                  />
                  {index < 9 && (
                    <Kbd
                      className="question-option-key flex-none min-w-5 h-5 inline-grid place-items-center [border:1px_solid_transparent] rounded-(--radius-xs) [font:500_11px_var(--mono)] text-muted-foreground bg-fill"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </Kbd>
                  )}
                  <span>
                    {option.label}
                    {option.description && (
                      <span className="muted text-muted-foreground block small text-caption">{option.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          <Textarea
            rows={1}
            className="question-answer"
            aria-label={t('Answer: {0}', { '0': q.question })}
            placeholder={q.options.length ? t('Or type your own answer') : t('Type your answer')}
            value={typed}
            maxLength={10000}
            onChange={(event) => setDrafts((old) => ({ ...old, [key]: event.target.value }))}
          />
          {answered && (
            <p className="outcome text-caption text-muted-foreground mt-1.5">
              {t('Answer submitted: {0}', { '0': answered })}
            </p>
          )}
        </fieldset>
        {error && (
          <p className="error text-bad" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="question-dock-actions flex flex-wrap items-center gap-2 pt-1">
        {!answered && (
          <Button
            variant="ghost"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
            disabled={busy}
            onClick={() => void dismiss()}
          >
            {t('Dismiss')}
          </Button>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {page > 0 && (
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={busy}
            onClick={() => setPage(page - 1)}
          >
            {t('Back')}
          </Button>
        )}
        {!together && !answered && (
          <Button
            variant="secondary"
            className={last ? PRIMARY_ACTION_CLASS : ''}
            disabled={busy || !value.trim()}
            onClick={() => void send([key])}
          >
            {t('Send answer')}
          </Button>
        )}
        {!last && (
          <Button
            variant="secondary"
            className={together ? PRIMARY_ACTION_CLASS : ''}
            disabled={busy}
            onClick={() => setPage(page + 1)}
          >
            {t('Next')}
          </Button>
        )}
        {together && last && (
          <Button
            variant="default"
            className={PRIMARY_ACTION_CLASS}
            disabled={!canSendAll}
            title={canSendAll ? undefined : t('Answer every question first')}
            onClick={() => void send(unanswered.map(questionKey))}
          >
            {questions.length > 1 ? t('Send answers together') : t('Send answer')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Where the agent asked, in the transcript. While it waits, a click opens the question above the message box. */
export { QuestionRow } from './QuestionRow'
