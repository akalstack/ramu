import { VIEW_ONLY_WRITE_NOTICE } from '../../../composer/viewerAccess'
import { helperActions, helperActive } from '@ramu/shared/chat/helperPresentation'
import { useHostConnection } from '../../../workspace/computers'
import { t as translate, useLanguage } from '../../../i18n'
import { AgentContentView } from '../../../chat/AgentContentView'
import { Button } from '@/components/desktop-button'
import { ArrowLeft, ArrowUp, Bot, Square, X } from 'lucide-react'
import { visibleText } from '../lib/messages'
import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentEvent } from '@ramu/shared/types'
import { advisorTranscript, effectiveStatus, parseTaskMessage } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { Textarea } from '@/components/ui/textarea'
import { type ToolResult } from '../types'
import { toBlocks } from '../lib/blocks'
import { ToolGroup } from './ToolGroup'
import { AssistantText } from './AssistantText'
import { TurnDiff } from './TurnDiff'
import { TASK_STATUS, TaskStatusIcon, taskMeta } from './TaskStatus'
import { AgentTaskCard } from './AgentTaskCard'
import { ThinkingRow } from './ThinkingRow'
import {
  GHOST_TEXT_BUTTON_CLASS,
  ICON_BUTTON_CLASS,
  PANEL_BODY_CLASS,
  PANEL_HEADER_CLASS,
  PANEL_LABEL_CLASS,
  PANEL_TITLE_CLASS,
} from '../styles'
import { Message, MessageContent } from '@/components/ui/message'
import { ErrorNote } from './ErrorNote'
import { UserBubble } from './UserMessage'

/** One sub-agent's own conversation beside the chat, or the list of all of them. */
export function AgentTaskPanel({
  tasks,
  selectedIds,
  openId,
  events,
  results,
  cwd,
  live,
  taskId,
  onSelect,
  onClose,
  onStop,
  readOnly = false,
  onMessage,
}: {
  tasks: AgentTask[]
  selectedIds?: string[]
  openId: string
  events: AgentEvent[]
  results: Map<string, ToolResult>
  cwd: string
  live: boolean
  taskId?: string
  onSelect: (id: string | null) => void
  onClose: () => void
  readOnly?: boolean
  onStop: (task: AgentTask) => void
  onMessage: (task: AgentTask, text: string) => Promise<void>
}) {
  useLanguage()
  const { offline } = useHostConnection()
  const task = openId === '*' ? undefined : tasks.find((entry) => entry.agentId === openId)
  const [showHistory, setShowHistory] = useState(false)
  const listed = selectedIds
    ? tasks.filter((entry) => selectedIds.includes(entry.agentId))
    : tasks.filter((entry) => entry.taskType !== 'advisor')
  const historical = tasks.filter((entry) => !listed.includes(entry) && entry.taskType !== 'advisor')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setDraft('')
  }, [openId])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Its own output, plus what you sent it through the main agent.
  const own = useMemo(() => {
    if (!task) return []
    const address = task.address ?? task.agentId
    // A background command has no conversation; its transcript is the Bash call that started it and that call's output.
    if (task.taskType === 'local_bash')
      return toBlocks(events.filter((event) => event.kind === 'tool-use' && event.toolUseId === task.toolUseId))
    return toBlocks(
      (task.taskType === 'advisor' ? advisorTranscript(events, task.agentId) : events).flatMap(
        (event): AgentEvent[] => {
          if (event.kind === 'user' && event.agentId === task.agentId) {
            const { agentId: _, ...rest } = event
            return [rest as AgentEvent]
          }
          if (event.kind === 'user') {
            const relay = parseTaskMessage(event.text)
            return relay?.address === address ? [{ ...event, text: relay.body }] : []
          }
          if (event.kind === 'agent' || event.agentId !== task.agentId) return []
          const { agentId: _, ...rest } = event
          return [rest as AgentEvent]
        },
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [events, task?.agentId, task?.address, task?.taskType, task?.toolUseId] by design; the values it reads beyond these are current as of that run
  }, [events, task?.agentId, task?.address, task?.taskType, task?.toolUseId])
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [own.length])
  const actions = task ? helperActions(task, !offline) : { canStop: false, canMessage: false }
  const status = task ? effectiveStatus(task, live) : 'stopped'
  const send = async () => {
    if (readOnly || !task || !draft.trim() || sending) return
    setSending(true)
    try {
      await onMessage(task, draft.trim())
      setDraft('')
    } finally {
      setSending(false)
    }
  }
  return (
    <aside
      className="agent-panel absolute inset-[0_0_0_auto] z-6 w-[min(440px,_100%)] flex flex-col bg-canvas [box-shadow:-16px_0_32px_rgba(0,_0,_0,_0.28)] [animation:fade_0.12s_var(--ease)] [box-sizing:border-box] min-w-0 max-w-full overflow-hidden [border-left:var(--pane-border-width)_solid_var(--pane-border-color)]"
      aria-label={task ? translate('Agent {0}', { '0': task.name }) : translate('Agents')}
    >
      <header className={PANEL_HEADER_CLASS}>
        {task && tasks.length > 1 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={translate('All agents')}
            title={translate('All agents')}
            onClick={() => onSelect('*')}
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        {task ? (
          <>
            <TaskStatusIcon status={status} active={!offline && Boolean(task && helperActive(task))} />
            <span className={PANEL_TITLE_CLASS} title={task.name}>
              {task.name}
            </span>
          </>
        ) : (
          <>
            <Bot size={15} />
            <span className={PANEL_TITLE_CLASS}>{translate('Agents')}</span>
          </>
        )}
        <span className="grow flex-1 min-w-0 text-left" />
        {task && actions.canStop && !readOnly && (
          <Button variant="ghost" size="sm" className={GHOST_TEXT_BUTTON_CLASS} onClick={() => onStop(task)}>
            <Square size={11} />
            {translate('Stop')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={translate('Close agent panel')}
          title={translate('Close (Esc)')}
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </header>
      {!task ? (
        <div className={`${PANEL_BODY_CLASS} agent-panel-list gap-2 pt-3`}>
          {listed.map((entry) => (
            <AgentTaskCard
              key={entry.agentId}
              task={entry}
              live={live}
              onOpen={() => onSelect(entry.agentId)}
              onStop={onStop}
              readOnly={readOnly}
            />
          ))}
          {historical.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((value) => !value)}
              >
                {translate('Earlier activity')} · {historical.length}
              </Button>
              {showHistory &&
                historical.map((entry) => (
                  <AgentTaskCard
                    key={entry.agentId}
                    task={entry}
                    live={live}
                    onOpen={() => onSelect(entry.agentId)}
                    onStop={onStop}
                    readOnly={readOnly}
                  />
                ))}
            </>
          )}
          {tasks
            .filter((entry) => entry.taskType === 'advisor')
            .map((entry) => (
              <AgentTaskCard
                key={entry.agentId}
                task={entry}
                live={live}
                onOpen={() => onSelect(entry.agentId)}
                onStop={onStop}
                readOnly={readOnly}
              />
            ))}
        </div>
      ) : (
        <>
          <div className="agent-panel-meta p-[8px_14px_0] flex-none muted text-muted-foreground small text-caption">
            {[translate(TASK_STATUS[status]), taskMeta(task, status)].filter(Boolean).join(' · ')}
          </div>
          <div ref={body} className={PANEL_BODY_CLASS}>
            {task.recoveryError && (
              <p className="muted text-muted-foreground small text-caption" role="status">
                {translate(
                  'Saved provider history could not be fully recovered. Previously received output is still shown.',
                )}{' '}
                {task.recoveryError}
              </p>
            )}
            {task.prompt && (
              <div className="agent-panel-prompt p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised">
                <span className={PANEL_LABEL_CLASS}>{translate('Task')}</span>
                <div className="agent-panel-prompt-text whitespace-pre-wrap [overflow-wrap:anywhere] text-soft text-control leading-[1.5]">
                  {task.prompt}
                </div>
              </div>
            )}
            {own.map((block, index) => (
              <div key={index}>
                {block.kind === 'tools' ? (
                  <ToolGroup
                    tools={block.tools}
                    results={results}
                    cwd={cwd}
                    active={status === 'running' && live}
                    taskId={taskId}
                  />
                ) : block.event.kind === 'text' ? (
                  <AssistantText event={block.event} generating={false} actions={false} taskId={taskId} />
                ) : block.event.kind === 'content' ? (
                  <AgentContentView content={block.event.content} taskId={taskId} />
                ) : block.event.kind === 'turn-diff' ? (
                  <TurnDiff diff={block.event.diff} />
                ) : block.event.kind === 'user' ? (
                  <Message align="end">
                    <MessageContent className="items-end">
                      <UserBubble>{visibleText(block.event.text)}</UserBubble>
                    </MessageContent>
                  </Message>
                ) : block.event.kind === 'thinking' ? (
                  <ThinkingRow text={block.event.text} active={status === 'running' && live && block === own.at(-1)} />
                ) : block.event.kind === 'error' ? (
                  <ErrorNote message={block.event.message} />
                ) : null}
              </div>
            ))}
            {!own.length && (
              <p className="muted text-muted-foreground small text-caption">
                {status === 'running'
                  ? translate('Working… its messages and tool calls appear here.')
                  : task.taskType === 'local_bash'
                    ? translate('This command left no output.')
                    : translate('This agent left no transcript.')}
              </p>
            )}
            {status !== 'running' &&
              (task.error ||
                (task.summary &&
                  task.summary.toLowerCase() !== TASK_STATUS[status].toLowerCase() &&
                  !own.some(
                    (block) =>
                      block.kind === 'event' &&
                      block.event.kind === 'text' &&
                      block.event.text.trim() === task.summary!.trim(),
                  ))) && (
                <div
                  className={`agent-panel-report [&.error]:[border-color:color-mix(in_srgb,_var(--bad)_40%,_transparent)] [&_p]:m-0 p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised${task.error ? ' error text-bad' : ''}`}
                >
                  <span className={PANEL_LABEL_CLASS}>{task.error ? translate('Error') : translate('Report')}</span>
                  <Markdown remarkPlugins={[remarkGfm]}>{task.error ?? task.summary ?? ''}</Markdown>
                </div>
              )}
          </div>
          {readOnly && (
            <p className="px-3 text-caption text-muted-foreground" role="status">
              {translate(VIEW_ONLY_WRITE_NOTICE)}
            </p>
          )}
          {actions.canMessage ? (
            <form
              className="agent-panel-compose [&_textarea]:min-h-[56px] [&_textarea]:max-h-[160px] [&_textarea]:p-[8px_44px_8px_12px] [&_textarea]:[border:1px_solid_transparent] [&_textarea]:rounded-(--radius-m) [&_textarea]:[background:var(--field)] [&_textarea]:resize-none [&_textarea]:text-control relative flex-none m-[0_10px_10px] min-w-0"
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              <Textarea
                aria-label={translate('Message {0}', { '0': task.name })}
                placeholder={translate('Message {0}…', { '0': task.name })}
                disabled={readOnly}
                value={draft}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              {/* The thread composer's send button, so sending reads the same in both places. */}
              <Button
                variant="default"
                size="icon-sm"
                type="submit"
                className="send agent-panel-send absolute right-2 bottom-2 rounded-full"
                aria-label={translate('Send to agent')}
                title={translate('Send through the main agent')}
                disabled={readOnly || !draft.trim() || sending}
              >
                <ArrowUp size={16} strokeWidth={2.25} />
              </Button>
            </form>
          ) : (
            <p className="agent-panel-hint flex-none m-0 p-[10px_14px_14px] min-w-0 muted text-muted-foreground small text-caption">
              {task.taskType === 'advisor'
                ? translate("The advisor answers the thread's agent and does not take messages.")
                : task.recovered
                  ? translate('This sub-agent’s previous process ended. Continue through the main thread.')
                  : task.canMessage
                    ? translate('Reconnect to message this agent.')
                    : translate('Background commands do not take messages.')}
            </p>
          )}
        </>
      )}
    </aside>
  )
}
