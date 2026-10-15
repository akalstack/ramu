import { ReferenceText } from '../../../chat/ChatReferences'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Bot, ChevronRight, Lightbulb, Pencil, ShieldQuestion, Square } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentEvent, Attachment } from '@ramu/shared/types'
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
import { parseAnswerMessage } from '@ramu/shared/chat/questions'
import { visibleText } from '../lib/messages'
import { MessageTime } from './MessageTime'
import { CopyButton } from './CopyButton'
import { CARET_CLASS, ICON_BUTTON_CLASS, MSG_ACTIONS_CLASS, MSG_CLASS, MSG_TO_CLASS } from '../styles'

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
    <div className={`${MSG_ACTIONS_CLASS}${latest ? ' always' : ''}`}>
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
    </div>
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
  editor,
  onEdit,
  onOpenAgent,
}: {
  event: Extract<AgentEvent, { kind: 'user' }>
  taskId?: string
  latest: boolean
  editor?: React.ReactNode
  onEdit?: (text: string, attachments: Attachment[]) => void
  onOpenAgent?: (agentId: string) => void
}) {
  useLanguage()
  const text = visibleText(e.text)
  const comments = sentComments(e.text)
  if (!text && !e.attachments?.length && !comments.length) return null
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
        <span>
          {advice.failed
            ? translate('The advisor could not answer: {0}', { '0': advice.body })
            : translate('Advice delivered to the agent')}
        </span>
        {advice.advisor && <span className="chat-activity-meta">{advice.advisor}</span>}
        <ChevronRight size={13} className={CARET_CLASS} />
      </ChatActivityButton>
    )
  if (report)
    return (
      <div className="task-report [&_.msg.assistant]:p-0 m-[8px_0] p-[10px_14px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised">
        <div className="task-report-title flex items-center gap-1.5 mb-1 font-semibold text-control">
          <Bot size={13} />
          {report.name} <span className="muted text-muted-foreground">{report.verb}</span>
        </div>
        <div className={`${MSG_CLASS} assistant`}>
          <Markdown remarkPlugins={[remarkGfm]}>{report.body}</Markdown>
        </div>
      </div>
    )
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
  if (answers)
    return (
      <div className="msg-wrap user">
        <span className={MSG_TO_CLASS}>
          <ShieldQuestion size={12} />
          {translate("Answers to the agent's questions")}
        </span>
        <div className={`${MSG_CLASS} user`}>{answers.body}</div>
        <div className={`${MSG_ACTIONS_CLASS}${latest ? ' always' : ''}`}>
          <MessageTime at={e.at} />
          <CopyButton text={answers.body} />
        </div>
      </div>
    )
  // A message relayed to a sub-agent shows who it is for, not the relay instructions.
  const relay = parseTaskMessage(e.text)
  if (editor)
    return (
      <div className="msg-wrap user" aria-current>
        {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
        {editor}
      </div>
    )
  return (
    <div className="msg-wrap user">
      {relay && (
        <span className={MSG_TO_CLASS}>
          <Bot size={12} />
          {translate('To ')}
          {relay.name}
        </span>
      )}
      {e.attachments?.length ? <Attachments files={e.attachments} /> : null}
      {relay ? (
        <div className={`${MSG_CLASS} user`}>
          <ReferenceText text={relay.body} taskId={taskId} />
        </div>
      ) : text ? (
        <div className={`${MSG_CLASS} user`}>
          <ReferenceText text={text} taskId={taskId} />
        </div>
      ) : null}
      {comments.length > 0 && <SentComments comments={comments} />}
      <UserMessageActions event={e} text={text} latest={latest} onEdit={onEdit} />
    </div>
  )
}
