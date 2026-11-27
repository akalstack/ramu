import { VIEW_ONLY_WRITE_NOTICE } from '../../../composer/viewerAccess'
import { helperActions, helperActive, helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { useHostConnection } from '../../../workspace/HostProvider'
import { t as translate, useLanguage } from '../../../i18n'
import { AgentContentView } from '../../../chat/AgentContentView'
import { Button } from '@/components/desktop-button'
import { ArrowLeft, Bot, Square, X } from 'lucide-react'
import { visibleText } from '../lib/messages'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from '../../../chat/MarkdownText'
import type { AgentEvent } from '@ramu/shared/types'
import { effectiveStatus, helperConversation } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { Composer } from '../../../composer/Composer'
import { type ToolResult } from '../types'
import { toBlocks } from '../lib/blocks'
import { ToolGroup } from './ToolGroup'
import { groupToolThinking, isLiveToolGroup } from '../lib/toolThinking'
import { AssistantText } from './AssistantText'
import { TurnDiff } from './TurnDiff'
import { HelperIcon, RoleTag, TASK_STATUS, TaskStatusIcon, taskMeta } from './TaskStatus'
import { ActivityText } from '../../../chat/ActivityText'
import { cn } from 'cn'
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

/** A brief longer than this many characters or lines opens folded. */
const LONG_PROMPT = { characters: 320, lines: 4 }

/**
 * What the helper was asked to do. A long brief opens folded to its first lines, so the helper's work is on screen
 * without scrolling past it; Show more opens it in place.
 */
function TaskPrompt({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > LONG_PROMPT.characters || text.split('\n').length > LONG_PROMPT.lines
  return (
    <>
      <div
        className={cn(
          'agent-panel-prompt-text whitespace-pre-wrap [overflow-wrap:anywhere] text-soft text-control leading-[1.5]',
          long && !open && 'line-clamp-4',
        )}
      >
        {text}
      </div>
      {long && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(GHOST_TEXT_BUTTON_CLASS, 'ml-[-8px] self-start')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? translate('Show less') : translate('Show more')}
        </Button>
      )}
    </>
  )
}

/** One sub-agent's own conversation beside the chat, or the list of all of them. */
export function AgentTaskPanel({
  tasks,
  commands,
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
  /** Commands the agent moved to the background; one opens here with its output, but they are not listed as agents. */
  commands?: AgentTask[]
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
  const task =
    openId === '*'
      ? undefined
      : (tasks.find((entry) => entry.agentId === openId) ?? commands?.find((entry) => entry.agentId === openId))
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
  const own = useMemo(
    () => (task ? toBlocks(helperConversation(events, task)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [events, task?.agentId, task?.address, task?.taskType, task?.toolUseId] by design; the values it reads beyond these are current as of that run
    [events, task?.agentId, task?.address, task?.taskType, task?.toolUseId],
  )
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [own.length])
  const actions = task ? helperActions(task, !offline) : { canStop: false, canMessage: false }
  const status = task ? effectiveStatus(task, live) : 'stopped'
  const running = status === 'running' && live
  const work = useMemo(() => groupToolThinking(own), [own])
  const statusGroup = running ? own.findLast((block) => block.kind === 'tools') : undefined
  const working = !offline && !!task && helperActive(task)
  const meta = task ? taskMeta(task, status) : ''
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
      <header className={cn(PANEL_HEADER_CLASS, task && 'min-h-14 gap-2.5 py-2 [border-bottom:1px_solid_var(--line)]')}>
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
            <HelperIcon task={task} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className={PANEL_TITLE_CLASS} title={task.name}>
                  {task.name}
                </span>
                <RoleTag task={task} />
              </span>
              <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
                <TaskStatusIcon status={status} active={working} />
                <ActivityText active={status === 'running' && working} className="flex-none">
                  {offline ? `${translate('Last known')} · ` : ''}
                  {translate(helperStatusLabel(task))}
                </ActivityText>
                {meta && (
                  <span className="min-w-0 truncate" title={meta}>
                    · {meta}
                  </span>
                )}
              </span>
            </span>
          </>
        ) : (
          <>
            <Bot size={15} />
            <span className={PANEL_TITLE_CLASS}>{translate('Agents')}</span>
            <span className="grow flex-1 min-w-0 text-left" />
          </>
        )}
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
                <TaskPrompt key={task.agentId} text={task.prompt} />
              </div>
            )}
            {work.map((item) => {
              if (Array.isArray(item)) return null
              const block = item.kind === 'work' ? item.block : item
              return (
                <div key={own.indexOf(item.kind === 'work' ? item.first : item)}>
                  {block.kind === 'tools' ? (
                    // Thoughts between calls fold into the group and the newest group names what it is doing now, as in the chat.
                    <ToolGroup
                      tools={block.tools}
                      entries={item.kind === 'work' ? item.entries : undefined}
                      results={results}
                      cwd={cwd}
                      active={running}
                      live={isLiveToolGroup(block, statusGroup, own)}
                      taskId={taskId}
                      bare={task.taskType === 'local_bash'}
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
                    <ThinkingRow text={block.event.text} active={running && block === own.at(-1)} />
                  ) : block.event.kind === 'error' ? (
                    <ErrorNote message={block.event.message} />
                  ) : null}
                </div>
              )
            })}
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
                  className={`agent-panel-report [&.error]:[border-color:color-mix(in_srgb,_var(--bad)_40%,_transparent)] p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised${task.error ? ' error text-bad' : ''}`}
                >
                  <span className={PANEL_LABEL_CLASS}>{task.error ? translate('Error') : translate('Report')}</span>
                  <MarkdownText density="compact" className={task.error ? 'text-bad' : undefined}>
                    {task.error ?? task.summary ?? ''}
                  </MarkdownText>
                </div>
              )}
          </div>
          {readOnly && (
            <p className="px-3 text-caption text-muted-foreground" role="status">
              {translate(VIEW_ONLY_WRITE_NOTICE)}
            </p>
          )}
          {actions.canMessage ? (
            // The thread's own composer, focused on this agent: no files or model, since a message reaches it as text
            // through the thread's agent.
            <div className="flex-none min-w-0 p-[0_10px_10px]">
              <Composer
                value={draft}
                scopeId={taskId}
                onChange={setDraft}
                onSubmit={send}
                placeholder={translate('Message {0}…', { '0': task.name })}
                submitLabel={translate('Send to agent')}
                submitTitle={translate('Send through the main agent')}
                disabled={readOnly || sending}
              />
            </div>
          ) : (
            <p className="agent-panel-hint flex-none m-0 p-[10px_14px_14px] min-w-0 muted text-muted-foreground small text-caption">
              {task.taskType === 'advisor'
                ? translate('The advisor answers the thread’s agent and does not take messages.')
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
