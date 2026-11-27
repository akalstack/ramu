import { useContext, useLayoutEffect, useRef, useState } from 'react'
import { ReferenceText } from '../../../chat/ChatReferences'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import {
  AppWindow,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  MousePointerClick,
  Pencil,
  ShieldQuestion,
  Square,
} from 'lucide-react'
import { sentInteractiveAttachments } from '@ramu/shared/interactive'
import { sentTerminalAttachments } from '@ramu/shared/chat/terminalContext'
import { TerminalAttachmentChip } from '../../../chat/TerminalAttachmentChip'
import type { AgentEvent, AgentQuestion, AgentTask, Attachment } from '@ramu/shared/types'
import { ChatActivityButton } from '../../../chat/ChatActivity'
import {
  advisorAgentId,
  parseAdvice,
  parseTaskMessage,
  parseTaskReport,
  parseTaskStop,
} from '@ramu/shared/chat/agentTasks'
import { sentComments } from '../../../git/ReviewChip'
import { Attachments } from '../../../composer/Attachments'
import { answerChoices, answerPairs, parseAnswerMessage } from '@ramu/shared/chat/questions'
import { parseInlineUiActionMessage } from '@ramu/shared/chat/inlineUi'
import { visibleText } from '../lib/messages'
import { ThreadAgents } from '../lib/threadAgents'
import { HelperIcon, RoleTag, TaskStatusIcon } from './TaskStatus'
import { REPORT_STATUS } from '@ramu/shared/chat/helperPresentation'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { UserBubble } from '../../../chat/UserBubble'
export { UserBubble } from '../../../chat/UserBubble'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'
import { MarkdownText } from '../../../chat/MarkdownText'
import { MessageActions } from './MessageActions'
import { useSentRise } from '../../../chat/ChatMotion'
import { CARET_CLASS, ICON_BUTTON_CLASS } from '../styles'

/** Soft line breaks stay as typed; the spacing around blocks comes from Markdown instead of the bubble's pre-wrap. */
const USER_MARKDOWN_CLASS = 'whitespace-normal [&_p]:whitespace-pre-wrap'

/** Review comments that went out with a message, as small cards under it. */
function SentComments({ comments }: { comments: ReturnType<typeof sentComments> }) {
  return (
    <div className="sent-comments flex flex-col gap-1.5 self-end w-[min(420px,_100%)] mt-1.5">
      {comments.map((c, i) => (
        <div
          key={i}
          className="sent-comment [&_p]:m-[4px_0_0] [&_p]:text-control [&_p]:leading-[1.45] [&_p]:whitespace-pre-wrap [&_p]:[overflow-wrap:anywhere] [&_.comments-popover-file]:text-muted-foreground p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised"
        >
          <div className="comments-popover-where [&_.review-note-where]:flex-none [&_.review-note-where]:cursor-default flex items-center gap-2 text-caption min-w-0">
            <span className="review-note-where [&:hover:not(:disabled)]:[background:color-mix(in_srgb,_var(--accent)_28%,_transparent)] [&:is(span)]:cursor-default p-[1px_7px] [border:0] rounded-(--radius-s) bg-brand-wash text-brand font-mono text-caption leading-[18px] cursor-pointer">
              {c.label}
            </span>
            <span
              className="comments-popover-file overflow-hidden text-ellipsis whitespace-nowrap min-w-0 text-muted-foreground"
              title={c.path}
            >
              {c.path}
            </span>
          </div>
          <p>{c.text}</p>
        </div>
      ))}
    </div>
  )
}

/** The hover row under a sent message: time, copy and (when editable) edit. */
function UserMessageActions({
  event: e,
  text,
  latest,
  onEdit,
}: {
  event: Extract<AgentEvent, { kind: 'user' }>
  text: string
  latest: boolean
  onEdit?: (text: string, attachments: Attachment[]) => void
}) {
  return (
    <MessageActions latest={latest} className="mt-0.5 mr-1">
      <MessageTime at={e.at} />
      <CopyButton text={text} />
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON_CLASS} copy-btn`}
          aria-label={translate('Edit message')}
          title={translate('Edit and send again')}
          onClick={() => onEdit(text, e.attachments ?? [])}
        >
          <Pencil size={14} />
        </Button>
      )}
    </MessageActions>
  )
}

/** The user's side of the conversation: a right-aligned shadcn message with an optional caption and attachments above its bubble. */
function UserShell({
  header,
  attachments,
  children,
  ...props
}: React.ComponentProps<typeof Message> & { header?: React.ReactNode; attachments?: Attachment[] }) {
  // The host's copy of a message sent from here finishes the rise its pending copy began.
  const rise = useSentRise<HTMLDivElement>(false)
  return (
    <Message align="end" className="mt-3.5" {...props}>
      <MessageContent ref={rise} className="max-w-[86%] origin-bottom-right items-end gap-2">
        {header && <MessageHeader className="gap-1 px-0">{header}</MessageHeader>}
        {attachments?.length ? <Attachments files={attachments} names className="justify-end" /> : null}
        {children}
      </MessageContent>
    </Message>
  )
}

/**
 * A message in the user's place in the transcript. Besides what you typed it can be a sub-agent's report,
 * delivered advice, a stop request, late answers or a relay to a sub-agent, each shown in its own form.
 */
export function UserMessage({
  event: e,
  taskId,
  latest,
  askedQuestions,
  editor,
  onEdit,
  onOpenAgent,
}: {
  event: Extract<AgentEvent, { kind: 'user' }>
  taskId?: string
  latest: boolean
  /** What each question request asked, so answers show the choices they were picked from. */
  askedQuestions?: Map<string, AgentQuestion[]>
  editor?: React.ReactNode
  onEdit?: (text: string, attachments: Attachment[]) => void
  onOpenAgent?: (agentId: string) => void
}) {
  useLanguage()
  const text = visibleText(e.text)
  const comments = sentComments(e.text)
  const content = sentInteractiveAttachments(e.text)
  const terminal = sentTerminalAttachments(e.text)
  if (!text && !e.attachments?.length && !comments.length && !content.length && !terminal.length) return null
  // A sub-agent's report comes back as a message, shown as a report and not as something you typed.
  const report = parseTaskReport(e.text)
  // Advice delivered after the advisor answered: the card holds the advice, this marks where the agent received it.
  const advice = parseAdvice(e.text)
  if (advice)
    return (
      <ChatActivityButton
        type="button"
        className={`advice-delivered${advice.failed ? ' failed' : ''}`}
        onClick={() => onOpenAgent?.(advisorAgentId(advice.requestId))}
        title={translate("Open the advisor's answer")}
      >
        <Lightbulb size={13} />
        <span className={advice.failed ? 'min-w-0 truncate' : undefined}>
          {advice.failed
            ? translate('The advisor could not answer: {0}', { '0': advice.body })
            : translate('Advice delivered to the agent')}
        </span>
        {advice.advisor && <span className="chat-activity-meta">{advice.advisor}</span>}
        <ChevronRight size={13} className={CARET_CLASS} />
      </ChatActivityButton>
    )
  if (report) return <TaskReport report={report} onOpenAgent={onOpenAgent} />
  // Stopping a Codex sub-agent goes through the main agent; the chat shows it as a note.
  const stop = parseTaskStop(e.text)
  if (stop)
    return (
      <div className="chat-activity-row chat-note" role="status">
        <Square size={11} />
        {translate('Asked the agent to stop {0}', { '0': stop.name })}
      </div>
    )
  // Late answers are yours, so they stay on the right, without the delivery note the agent reads.
  const answers = parseAnswerMessage(e.text)
  // The question's own card already shows what was answered; a second bubble said it again. While that card is in the
  // thread this is one line that leads back to it, and the full answer shows only when the card is not there.
  if (answers && askedQuestions?.has(answers.requestId))
    return <AnsweredNote requestId={answers.requestId} count={answerPairs(answers.body).length} />
  if (answers)
    return (
      <UserShell
        header={
          <>
            <ShieldQuestion size={12} />
            {translate("Answers to the agent's questions")}
          </>
        }
      >
        <UserBubble>
          <span className="flex flex-col gap-2.5">
            {answerPairs(answers.body).map((pair, index) => {
              const asked = askedQuestions?.get(answers.requestId)?.find((q) => q.question === pair.question)
              const choices = answerChoices(asked, pair.answer)
              return (
                <span key={index} className="flex flex-col gap-1">
                  {pair.question && <span className="text-control text-muted-foreground">{pair.question}</span>}
                  {/* Every choice that was offered stays, with the picked ones marked, so the answer reads in context. */}
                  {choices ? (
                    <>
                      <span role="list" className="flex flex-col gap-0.5">
                        {choices.options.map((option) => (
                          <span
                            key={option.label}
                            role="listitem"
                            className={`flex items-center gap-2 ${option.chosen ? '' : 'text-muted-foreground'}`}
                          >
                            {option.chosen ? (
                              <Check size={13} className="flex-none text-brand" aria-label={translate('Chosen')} />
                            ) : (
                              <span aria-hidden className="size-[13px] flex-none" />
                            )}
                            <span className="min-w-0 flex-1">{option.label}</span>
                          </span>
                        ))}
                      </span>
                      {choices.typed && <span>{choices.typed}</span>}
                    </>
                  ) : (
                    <span>{pair.answer}</span>
                  )}
                </span>
              )
            })}
          </span>
        </UserBubble>
        <MessageActions latest={latest} className="mt-0.5 mr-1">
          <MessageTime at={e.at} />
          <CopyButton text={answers.body} />
        </MessageActions>
      </UserShell>
    )
  // A card's button reads as what the person did; the agent alone reads the A2UI action.
  const pressed = parseInlineUiActionMessage(e.text)
  if (pressed)
    return (
      <UserShell
        header={
          <>
            <MousePointerClick size={12} />
            {translate('From a card')}
          </>
        }
      >
        <UserBubble>{pressed.summary}</UserBubble>
        <MessageActions latest={latest} className="mt-0.5 mr-1">
          <MessageTime at={e.at} />
        </MessageActions>
      </UserShell>
    )
  // A message relayed to a sub-agent shows who it is for, not the relay instructions.
  const relay = parseTaskMessage(e.text)
  if (editor)
    return (
      <UserShell aria-current attachments={e.attachments}>
        {editor}
      </UserShell>
    )
  return (
    <UserShell
      attachments={e.attachments}
      header={
        relay ? (
          <>
            <Bot size={12} />
            {translate('To ')}
            {relay.name}
          </>
        ) : undefined
      }
    >
      {relay ? (
        <UserBubble>
          <ReferenceText text={relay.body} taskId={taskId} className={USER_MARKDOWN_CLASS} />
        </UserBubble>
      ) : text ? (
        <UserBubble>
          <ReferenceText text={text} taskId={taskId} className={USER_MARKDOWN_CLASS} />
        </UserBubble>
      ) : null}
      {comments.length > 0 && <SentComments comments={comments} />}
      {content.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-end gap-1 self-end">
          {content.map((item) => (
            <span
              key={`${item.id}:${item.version}`}
              className="inline-flex h-6 max-w-[260px] items-center gap-1.5 rounded-(--radius-s) bg-raised px-2 text-caption text-muted-foreground"
              title={translate('Asked about {0}', { '0': item.title })}
            >
              <AppWindow size={12} className="flex-none" aria-hidden />
              <span className="min-w-0 truncate text-foreground">{item.title}</span>v{item.version}
            </span>
          ))}
        </div>
      )}
      {terminal.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-end gap-1 self-end">
          {terminal.map((item, index) => (
            <TerminalAttachmentChip key={index} attachment={item} sent />
          ))}
        </div>
      )}
      <UserMessageActions event={e} text={text} latest={latest} onEdit={onEdit} />
    </UserShell>
  )
}

const REPORT_ICON: Record<string, AgentTask['status'] | undefined> = {
  finished: 'completed',
  failed: 'failed',
  stopped: 'stopped',
}

/**
 * What a sub-agent sent back, drawn like its card where it started: its model's icon, its name, the same
 * status words, and the report. Opening it shows that agent's conversation.
 */
function TaskReport({
  report,
  onOpenAgent,
}: {
  report: { name: string; verb: string; body: string }
  onOpenAgent?: (agentId: string) => void
}) {
  useLanguage()
  const agents = useContext(ThreadAgents)
  const agent = agents.findLast((task) => task.name === report.name)
  const status = REPORT_ICON[report.verb]
  // A helper's report is for the lead, so it folds to a preview.
  const [expanded, setExpanded] = useState(false)
  const [long, setLong] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  // Whether the report runs past its preview; measured while folded, kept while open.
  useLayoutEffect(() => {
    const el = body.current
    if (el && !expanded) setLong(el.scrollHeight > el.clientHeight + 1)
  }, [report.body, expanded])
  return (
    <div className="task-report m-[8px_0] flex flex-col rounded-(--radius-m) bg-raised">
      <Button
        variant="ghost"
        type="button"
        className="flex h-auto w-full items-center justify-start gap-2.5 whitespace-normal rounded-(--radius-m) p-[8px_12px] text-left font-normal disabled:opacity-100"
        disabled={!agent}
        onClick={() => agent && onOpenAgent?.(agent.agentId)}
        aria-label={agent ? translate('Open agent {0}', { 0: report.name }) : undefined}
      >
        <HelperIcon task={agent} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold text-foreground">{report.name}</span>
          {agent && <RoleTag task={agent} />}
          <span className="inline-flex flex-none items-center gap-1 text-caption text-muted-foreground">
            {status && <TaskStatusIcon status={status} />}
            {translate(REPORT_STATUS[report.verb] ?? report.verb)}
          </span>
        </span>
        {agent && <ChevronRight size={14} className={CARET_CLASS} />}
      </Button>
      <div className="flex flex-col items-start px-3 pb-2 pl-[50px]">
        <MarkdownText
          ref={body}
          className={`msg assistant w-full text-soft ${
            expanded
              ? ''
              : `max-h-[7.5rem] overflow-hidden ${long ? '[mask-image:linear-gradient(to_bottom,black_55%,transparent)]' : ''}`
          }`}
        >
          {report.body}
        </MarkdownText>
        {long && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mt-0.5 text-caption text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? translate('Show less') : translate('Show full report')}
            <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        )}
      </div>
    </div>
  )
}

/** One line that stands for a sent answer and leads back to the question's card, which shows what was answered. */
export function AnsweredNote({ requestId, count }: { requestId: string; count: number }) {
  return (
    <ChatActivityButton
      type="button"
      className="self-end"
      title={translate('Show the question')}
      onClick={() => showQuestion(requestId)}
    >
      <ShieldQuestion size={13} />
      <span>{count === 1 ? translate('Answered 1 question') : translate('Answered {0} questions', { 0: count })}</span>
      <ArrowUp size={13} className={CARET_CLASS} />
    </ChatActivityButton>
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
