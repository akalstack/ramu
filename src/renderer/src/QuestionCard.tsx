import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const pager = requests.length > 1 && <span className="question-dock-pager">
    <Button className="ghost icon small-icon" aria-label={t("Previous question request")} disabled={index === 0} onClick={() => setCurrentId(requests[index - 1]!.requestId)}><ChevronLeft size={13} /></Button>
    <span className="muted small">{index + 1}/{requests.length}</span>
    <Button className="ghost icon small-icon" aria-label={t("Next question request")} disabled={index === requests.length - 1} onClick={() => setCurrentId(requests[index + 1]!.requestId)}><ChevronRight size={13} /></Button>
  </span>
  if (!open) return <div className={`question-dock collapsed${blocking ? ' blocking' : ''}`} role="region" aria-label={t("Questions from the agent")}>
    <Button type="button" className="question-dock-bar" aria-expanded={false} onClick={() => onOpenChange(true)}>
      <ShieldQuestion size={14} />
      <span className="question-dock-bar-text">{blocking ? t("The agent is waiting for your answer") : t("{0} waiting for your answer", { "0": remaining.length === 1 ? t("1 question") : t("{0} questions", { "0": remaining.length }) })}<span className="muted"> · {request.dependsOn || remaining[0]?.question}</span></span>
      <ChevronUp size={13} className="caret" />
    </Button>
  </div>
  return <div className={`question-dock${blocking ? ' blocking' : ''}`} role="region" aria-label={t("Questions from the agent")}>
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
  return <div ref={root} className="question-card question-dock-card" data-question-request={request.requestId} tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="question-dock-header">
      <ShieldQuestion size={14} />
      <span className="question-dock-title">{blocking ? t("The agent is waiting for your answer") : t("The agent can keep working. You can answer later.")}</span>
      {questions.length > 1 && <span className="muted small question-dock-step">{t("Question {0} of {1}", { "0": page + 1, "1": questions.length })}</span>}
      {pager}
      <Button className="ghost icon small-icon" aria-label={t("Answer later")} title={t("Answer later")} onClick={onCollapse}><ChevronDown size={14} /></Button>
    </header>
    {request.dependsOn && <p className="small question-dock-needed"><span className="muted">{t("Answer needed for: ")}</span>{request.dependsOn}</p>}
    {questions.length > 1 && <p className="muted small question-dock-note">{together ? t("These questions are related; send their answers together.") : t("Each answer can be sent separately.")}</p>}
    <fieldset key={key} disabled={busy || !!answered}>
      <legend>{q.question}</legend>
      {q.options.length > 0 && <div className="question-options">{q.options.map((option, index) => <label key={option.label} className={`option${selected.has(option.label) ? ' selected' : ''}`}>
        <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${request.requestId}:${key}`} checked={selected.has(option.label)} onChange={() => choose(option.label)} />
        {index < 9 && <Kbd className="question-option-key" aria-hidden="true">{index + 1}</Kbd>}
        <span>{option.label}{option.description && <span className="muted block small">{option.description}</span>}</span>
      </label>)}</div>}
      <Input aria-label={t("Answer: {0}", { "0": q.question })} placeholder={q.options.length ? t("Or type your own answer") : t("Type your answer")} value={typed} maxLength={10000} onChange={(event) => setDrafts((old) => ({ ...old, [key]: event.target.value }))} />
      {answered && <p className="outcome">{t("Answer submitted: {0}", { "0": answered })}</p>}
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="question-dock-actions">
      {async && <Button className="ghost" disabled={busy} onClick={() => void dismiss()}>{t("Dismiss")}</Button>}
      <span className="grow" />
      {page > 0 && <Button disabled={busy} onClick={() => setPage(page - 1)}>{t("Back")}</Button>}
      {!together && !answered && <Button className={last ? 'primary' : ''} disabled={busy || !value.trim()} onClick={() => void send([key])}>{t("Send answer")}</Button>}
      {!last && <Button className={together ? 'primary' : ''} disabled={busy} onClick={() => setPage(page + 1)}>{t("Next")}</Button>}
      {together && last && <Button className="primary" disabled={!canSendAll} title={canSendAll ? undefined : t("Answer every question first")} onClick={() => void send(unanswered.map(questionKey))}>{questions.length > 1 ? t("Send answers together") : t("Send answer")}</Button>}
    </div>
  </div>
}

/** Where the agent asked, in the transcript. While it waits, a click opens the question above the message box. */
export function QuestionRow({ request, status, pending, onOpen }: { request: QuestionRequest; status: QuestionState; pending: boolean; onOpen?: (requestId: string) => void }) {
  useLanguage()
  const summary = request.dependsOn || request.questions[0]?.question
  const count = request.questions.length === 1 ? t("Asked a question") : t("Asked {0} questions", { "0": request.questions.length })
  if (pending) return <Button type="button" className="question-row pending" data-question-request={request.requestId} onClick={() => onOpen?.(request.requestId)}>
    <ShieldQuestion size={13} /><span className="question-row-text"><strong>{count}</strong><span className="muted"> · {summary}</span></span><span className="question-row-state">{t("Waiting for your answer")}</span><ChevronRight size={13} className="caret" />
  </Button>
  const outcome = status.outcome === 'obsolete' ? t("No longer needed") : status.outcome === 'dismissed' ? t("Dismissed") : status.outcome === 'answered' ? t("Answered") : t("Cancelled")
  return <div className="question-row" data-question-request={request.requestId}>
    <div className="question-row-head"><ShieldQuestion size={13} /><strong>{count}</strong><span className="muted" aria-hidden="true">·</span><span className="muted">{outcome}{status.reason ? `: ${status.reason}` : ''}</span></div>
    <dl className="question-row-answers">{request.questions.map((q) => {
      const answer = questionAnswer(status.answers, questionKey(q))
      return <div key={questionKey(q)}><dt>{q.question}</dt><dd className={answer ? '' : 'muted'}>{answer ?? t("No answer")}</dd></div>
    })}</dl>
  </div>
}
