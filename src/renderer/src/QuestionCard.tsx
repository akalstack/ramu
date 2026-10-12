import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { questionKey, questionAnswer, type QuestionRequest, type QuestionState } from '../../shared/questions'
import { invoke } from './ipc'
import { errorText } from './TaskPane'

const EMPTY: QuestionState = { answers: {}, drafts: {}, waiting: false }

/**
 * Questions waiting for the user float above the message box, as in Codex and T3 Code: one question at a time,
 * numbered options, and the transcript keeps a short row where the agent asked.
 */
export function QuestionDock({ sessionId, requests, states, open, onOpenChange, focus }: { sessionId: string; requests: QuestionRequest[]; states: Map<string, QuestionState>; open: boolean; onOpenChange: (open: boolean) => void; focus: { requestId: string; at: number } | null }) {
  useLanguage()
  const [currentId, setCurrentId] = useState<string | null>(null)
  useEffect(() => { if (focus) { setCurrentId(focus.requestId); onOpenChange(true) } }, [focus])
  const index = Math.max(0, requests.findIndex((request) => request.requestId === currentId))
  const request = requests[index]
  if (!request) return null
  const status = states.get(request.requestId) ?? EMPTY
  const blocking = request.responseMode !== 'message' || status.waiting
  const remaining = request.questions.filter((q) => !questionAnswer(status.answers, questionKey(q)))
  const pager = requests.length > 1 && <span className="question-dock-pager inline-flex items-center gap-0.5 tabular-nums">
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Previous question request")} disabled={index === 0} onClick={() => setCurrentId(requests[index - 1]!.requestId)}><ChevronLeft size={13} /></Button>
    <span className="muted text-muted-foreground small text-caption">{index + 1}/{requests.length}</span>
    <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Next question request")} disabled={index === requests.length - 1} onClick={() => setCurrentId(requests[index + 1]!.requestId)}><ChevronRight size={13} /></Button>
  </span>
  if (!open) return <div className={`question-dock [&.blocking]:[border-color:color-mix(in_srgb,_var(--warn)_55%,_var(--line-strong))] [&.blocking_.question-dock-header_>_svg]:text-warn [&.blocking_.question-dock-bar_>_svg:first-child]:text-warn w-[calc(100%_-_24px)] max-w-[696px] m-[0_auto_8px] [border:1px_solid_var(--edge)] rounded-(--radius-l) bg-raised [box-shadow:var(--shadow-float)] overflow-hidden [animation:fade-only_120ms_var(--ease)] collapsed${blocking ? ' blocking' : ''}`} role="region" aria-label={t("Questions from the agent")}>
    <Button variant="secondary" type="button" className="bg-fill hover:bg-fill-hover question-dock-bar [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_>_svg:first-child]:flex-none [&_>_svg:first-child]:text-muted-foreground flex items-center justify-start gap-2 w-full h-[36px] p-[0_12px] [border:0] [border-radius:0] bg-transparent text-left text-foreground font-normal" aria-expanded={false} onClick={() => onOpenChange(true)}>
      <ShieldQuestion size={14} />
      <span className="question-dock-bar-text flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{blocking ? t("The agent is waiting for your answer") : t("{0} waiting for your answer", { "0": remaining.length === 1 ? t("1 question") : t("{0} questions", { "0": remaining.length }) })}<span className="muted text-muted-foreground"> · {request.dependsOn || remaining[0]?.question}</span></span>
      <ChevronUp size={13} className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]" />
    </Button>
  </div>
  return <div className={`question-dock [&.blocking]:[border-color:color-mix(in_srgb,_var(--warn)_55%,_var(--line-strong))] [&.blocking_.question-dock-header_>_svg]:text-warn [&.blocking_.question-dock-bar_>_svg:first-child]:text-warn w-[calc(100%_-_24px)] max-w-[696px] m-[0_auto_8px] [border:1px_solid_var(--edge)] rounded-(--radius-l) bg-raised [box-shadow:var(--shadow-float)] overflow-hidden [animation:fade-only_120ms_var(--ease)] ${blocking ? ' blocking' : ''}`} role="region" aria-label={t("Questions from the agent")}>
    <QuestionForm key={request.requestId} sessionId={sessionId} request={request} status={status} blocking={blocking} pager={pager} focusAt={focus?.requestId === request.requestId ? focus.at : null} onCollapse={() => onOpenChange(false)} />
  </div>
}

function QuestionForm({ sessionId, request, status, blocking, pager, focusAt, onCollapse }: { sessionId: string; request: QuestionRequest; status: QuestionState; blocking: boolean; pager: React.ReactNode; focusAt: number | null; onCollapse: () => void }) {
  useLanguage()
  const [drafts, setDrafts] = useState<Record<string, string>>(status.drafts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const together = request.grouping !== 'independent'
  const async = request.responseMode === 'message'
  const questions = request.questions
  const firstOpen = Math.max(0, questions.findIndex((q) => !questionAnswer(status.answers, questionKey(q))))
  const [page, setPage] = useState(firstOpen)
  const root = useRef<HTMLDivElement>(null)
  // Opened from the transcript: keys 1–9 pick an option right away. A question that just arrived does not take the caret.
  useEffect(() => { if (focusAt) root.current?.focus({ preventScroll: true }) }, [focusAt])
  useEffect(() => {
    const timer = setTimeout(() => { void invoke('agent.questionDraft', sessionId, request.requestId, drafts).catch(() => {}) }, 250)
    return () => clearTimeout(timer)
  }, [drafts, sessionId, request.requestId])
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
    setBusy(true); setError(null)
    try {
      await invoke('agent.replyQuestion', sessionId, request.requestId, Object.fromEntries(keys.map((k) => [k, questionAnswer(drafts, k) ?? ''])))
      // A separate answer moves on to the next question still open.
      const next = questions.findIndex((entry, index) => index > page && !questionAnswer(status.answers, questionKey(entry)) && !keys.includes(questionKey(entry)))
      if (!together && next >= 0) setPage(next)
    }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const dismiss = async () => {
    setBusy(true); setError(null)
    try { await invoke('agent.dismissQuestion', sessionId, request.requestId) }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  // Picking an option replaces typed text; with several allowed, it toggles among the picked options.
  const choose = (label: string) => setDrafts((old) => {
    const current = q.multiSelect ? [...selected] : []
    return { ...old, [key]: q.multiSelect ? (current.includes(label) ? current.filter((v) => v !== label) : [...current, label]).join(', ') : label }
  })
  const canSendAll = !busy && unanswered.every(filled)
  /** Enter moves on: next question, or send when everything this request needs is filled in. */
  const advance = () => {
    if (!together && !answered && value.trim()) return void send([key])
    if (!last) return setPage(page + 1)
    if (together && canSendAll) void send(unanswered.map(questionKey))
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const typing = event.target instanceof HTMLInputElement && event.target.type === 'text'
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (typing || event.target === root.current)) { event.preventDefault(); advance(); return }
    if (!typing && /^[1-9]$/.test(event.key) && !answered) { const option = q.options[Number(event.key) - 1]; if (option) { event.preventDefault(); choose(option.label) } }
  }
  return <div ref={root} className="question-card question-dock-card [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:m-0 [&_fieldset]:p-0 [&_fieldset]:[border:0] [&_fieldset]:min-w-0 [&_legend]:p-0 [&_legend]:mb-1 [&_legend]:font-semibold [&_legend]:text-chat [&_legend]:text-foreground [&_.option]:flex [&_.option]:items-center [&_.option]:gap-2.5 [&_.option]:p-[7px_10px] [&_.option]:[border:1px_solid_transparent] [&_.option]:rounded-(--radius-s) [&_.option]:cursor-pointer [&_.option]:bg-fill [&_.option:hover]:bg-hover [&_.option.selected]:[border-color:var(--line-strong)] [&_.option.selected]:bg-hover [&_.option_input]:absolute [&_.option_input]:opacity-0 [&_.option_input]:pointer-events-none [&_.option.selected_.question-option-key]:[border-color:var(--text)] [&_.option.selected_.question-option-key]:text-foreground flex flex-col gap-2.5 max-h-[min(52vh,_460px)] overflow-auto p-[12px_14px] outline-none" data-question-request={request.requestId} tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="question-dock-header [&_>_svg]:flex-none [&_>_svg]:text-muted-foreground flex items-center gap-2 text-control text-soft">
      <ShieldQuestion size={14} />
      <span className="question-dock-title flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{blocking ? t("The agent is waiting for your answer") : t("The agent can keep working. You can answer later.")}</span>
      {questions.length > 1 && <span className="muted text-muted-foreground small text-caption question-dock-step flex-none tabular-nums">{t("Question {0} of {1}", { "0": page + 1, "1": questions.length })}</span>}
      {pager}
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Answer later")} title={t("Answer later")} onClick={onCollapse}><ChevronDown size={14} /></Button>
    </header>
    {request.dependsOn && <p className="small text-caption question-dock-needed m-0"><span className="muted text-muted-foreground">{t("Answer needed for: ")}</span>{request.dependsOn}</p>}
    {questions.length > 1 && <p className="muted text-muted-foreground small text-caption question-dock-note m-0">{together ? t("These questions are related; send their answers together.") : t("Each answer can be sent separately.")}</p>}
    <fieldset key={key} disabled={busy || !!answered}>
      <legend>{q.question}</legend>
      {q.options.length > 0 && <div className="question-options grid gap-1">{q.options.map((option, index) => <label key={option.label} className={`option [.question-card_&]:items-center [.question-card_&_input]:w-4 [.question-card_&_input]:h-4 [.question-card_&_input]:flex-none [.question-card_&_input]:p-0 [.question-card_&_input]:m-0 [.question-card_&_>_span]:min-w-0 [.elicitation-card_&]:flex [.elicitation-card_&]:items-center [.elicitation-card_&]:gap-2 [.elicitation-card_&]:m-[8px_0] p-[4px_0] ${selected.has(option.label) ? ' selected' : ''}`}>
        <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${request.requestId}:${key}`} checked={selected.has(option.label)} onChange={() => choose(option.label)} />
        {index < 9 && <Kbd className="question-option-key flex-none min-w-5 h-5 inline-grid place-items-center [border:1px_solid_transparent] rounded-(--radius-xs) [font:500_11px_var(--mono)] text-muted-foreground bg-fill" aria-hidden="true">{index + 1}</Kbd>}
        <span>{option.label}{option.description && <span className="muted text-muted-foreground block block small text-caption">{option.description}</span>}</span>
      </label>)}</div>}
      <Input aria-label={t("Answer: {0}", { "0": q.question })} placeholder={q.options.length ? t("Or type your own answer") : t("Type your answer")} value={typed} maxLength={10000} onChange={(event) => setDrafts((old) => ({ ...old, [key]: event.target.value }))} />
      {answered && <p className="outcome text-caption text-muted-foreground mt-1.5">{t("Answer submitted: {0}", { "0": answered })}</p>}
    </fieldset>
    {error && <p className="error text-bad" role="alert">{error}</p>}
    <div className="question-dock-actions flex items-center gap-1.5">
      {async && <Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy} onClick={() => void dismiss()}>{t("Dismiss")}</Button>}
      <span className="grow flex-1 min-w-0 text-left" />
      {page > 0 && <Button variant="secondary" className="bg-fill hover:bg-fill-hover" disabled={busy} onClick={() => setPage(page - 1)}>{t("Back")}</Button>}
      {!together && !answered && <Button variant="secondary" className={last ? 'primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100' : ''} disabled={busy || !value.trim()} onClick={() => void send([key])}>{t("Send answer")}</Button>}
      {!last && <Button variant="secondary" className={together ? 'primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100' : ''} disabled={busy} onClick={() => setPage(page + 1)}>{t("Next")}</Button>}
      {together && last && <Button variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={!canSendAll} title={canSendAll ? undefined : t("Answer every question first")} onClick={() => void send(unanswered.map(questionKey))}>{questions.length > 1 ? t("Send answers together") : t("Send answer")}</Button>}
    </div>
  </div>
}

/** Where the agent asked, in the transcript. While it waits, a click opens the question above the message box. */
export function QuestionRow({ request, status, pending, showAnswers = true, onOpen }: { request: QuestionRequest; status: QuestionState; pending: boolean; showAnswers?: boolean; onOpen?: (requestId: string) => void }) {
  useLanguage()
  const summary = request.dependsOn || request.questions[0]?.question
  const count = request.questions.length === 1 ? t("Asked a question") : t("Asked {0} questions", { "0": request.questions.length })
  if (pending) return <Button variant="secondary" type="button" className="bg-fill hover:bg-fill-hover question-row [&:is(button).pending]:flex-row [&:is(button).pending]:items-center [&:is(button).pending]:gap-2 [&:is(button).pending]:w-full [&:is(button).pending]:h-auto [&:is(button).pending]:bg-raised [&:is(button).pending]:text-foreground [&:is(button).pending]:font-normal [&:is(button).pending]:text-left [&:is(button).pending]:whitespace-normal [&:is(button).pending:hover]:[border-color:var(--line-strong)] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex flex-col gap-1.5 m-[8px_0] p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) text-control bg-fill pending" data-question-request={request.requestId} onClick={() => onOpen?.(request.requestId)}>
    <ShieldQuestion size={13} /><span className="question-row-text flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"><strong>{count}</strong><span className="muted text-muted-foreground"> · {summary}</span></span><span className="question-row-state flex-none text-warn text-caption">{t("Waiting for your answer")}</span><ChevronRight size={13} className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]" />
  </Button>
  const outcome = status.outcome === 'obsolete' ? t("No longer needed") : status.outcome === 'dismissed' ? t("Dismissed") : status.outcome === 'answered' ? t("Answered") : t("Cancelled")
  return <div className="question-row [&:is(button).pending]:flex-row [&:is(button).pending]:items-center [&:is(button).pending]:gap-2 [&:is(button).pending]:w-full [&:is(button).pending]:h-auto [&:is(button).pending]:bg-raised [&:is(button).pending]:text-foreground [&:is(button).pending]:font-normal [&:is(button).pending]:text-left [&:is(button).pending]:whitespace-normal [&:is(button).pending:hover]:[border-color:var(--line-strong)] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex flex-col gap-1.5 m-[8px_0] p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) text-control bg-fill" data-question-request={request.requestId}>
    <div className="question-row-head [&_>_svg]:text-muted-foreground flex items-center gap-1.5"><ShieldQuestion size={13} /><strong>{count}</strong><span className="muted text-muted-foreground" aria-hidden="true">·</span><span className="muted text-muted-foreground">{outcome}{status.reason ? `: ${status.reason}` : ''}</span></div>
    {!showAnswers && <p className="m-0 text-muted-foreground">{summary}</p>}
    {showAnswers && <dl className="question-row-answers [&_>_div]:grid [&_>_div]:[grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] [&_>_div]:gap-3 [&_dt]:text-soft [&_dd]:m-0 grid gap-1 m-0">{request.questions.map((q) => {
      const answer = questionAnswer(status.answers, questionKey(q))
      return <div key={questionKey(q)}><dt>{q.question}</dt><dd className={answer ? '' : 'muted text-muted-foreground'}>{answer ?? t("No answer")}</dd></div>
    })}</dl>}
  </div>
}
