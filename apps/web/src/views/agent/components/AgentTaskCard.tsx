import { helperActions, helperActive, helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { useHostConnection } from '../../../workspace/computers'
import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Bot, Square, ChevronRight, SquareTerminal } from 'lucide-react'
import { providerName } from '../../../chat/AgentControls'
import { effectiveStatus } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { ProviderIcon } from '../../../models/ProviderIcon'
import { modelDisplayName } from '../../../models/ModelSets'
import { toolLabel } from '../lib/toolSummary'
import { useElapsed } from '../hooks/useElapsed'
import { TASK_STATUS, TaskStatusIcon, taskMeta, workSummary } from './TaskStatus'
import { CARET_CLASS, ICON_BUTTON_CLASS } from '../styles'
import { ActivityText } from '../../../chat/ActivityText'

/** A sub-agent in the main transcript, where the main agent started it. */
export function AgentTaskCard({
  task,
  live,
  onOpen,
  onStop,
  readOnly = false,
}: {
  task: AgentTask
  live: boolean
  onOpen: () => void
  readOnly?: boolean
  onStop: (task: AgentTask) => void
}) {
  useLanguage()
  const { offline } = useHostConnection()
  const actions = helperActions(task, !offline)
  const status = effectiveStatus(task, live)
  useElapsed(task.startedAt, !offline && helperActive(task))
  const final = task.error ?? task.summary
  const detail =
    status === 'running'
      ? (task.summary ??
        (task.lastTool ? translate('Using {0}', { 0: toolLabel(task.lastTool) }) : translate('Starting…')))
      : final && final.toLowerCase() !== TASK_STATUS[status].toLowerCase()
        ? final
        : undefined
  return (
    <div
      className={`agent-task-card [&.running]:[border-color:var(--line-strong)] [&:has(.agent-task-stop)_.agent-task-open]:pr-[44px] relative flex items-stretch [border:1px_solid_transparent] rounded-(--radius-m) bg-raised ${status}`}
    >
      <Button
        variant="secondary"
        type="button"
        className="bg-fill hover:bg-fill-hover agent-task-open [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:0] [&_.caret]:flex-none [&_.caret]:text-muted-foreground flex-1 min-w-0 flex items-center justify-start gap-2.5 h-auto min-h-[52px] p-[8px_12px] [border:0] [border-radius:inherit] bg-transparent text-left whitespace-normal"
        aria-label={translate('Open agent {0}', { '0': task.name })}
        onClick={onOpen}
      >
        <span className="agent-task-icon flex-none grid place-items-center w-7 h-7 rounded-(--radius-s) bg-accent text-soft">
          {task.taskType === 'local_bash' ? (
            <SquareTerminal size={15} />
          ) : task.provider ? (
            <ProviderIcon provider={task.provider} size={14} />
          ) : (
            <Bot size={15} />
          )}
        </span>
        <span className="agent-task-text flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="agent-task-title flex items-center gap-2 min-w-0">
            <span className="agent-task-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground">
              {task.name}
            </span>
            <span
              className={`agent-task-state flex-none inline-flex items-center gap-1 text-muted-foreground text-caption ${status}`}
            >
              <TaskStatusIcon status={status} active={!offline && helperActive(task)} />
              <ActivityText active={status === 'running' && !offline && helperActive(task)}>
                {offline ? `${translate('Last known')} · ` : ''}
                {translate(helperStatusLabel(task))}
              </ActivityText>
            </span>
          </span>
          {detail && (
            <span className="agent-task-detail text-soft text-control overflow-hidden text-ellipsis whitespace-nowrap">
              {detail}
            </span>
          )}
          {taskMeta(task, status) && (
            <span className="agent-task-meta text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap">
              {taskMeta(task, status)}
            </span>
          )}
          {task.work && (
            <span
              className="agent-task-work text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap tabular-nums"
              title={task.work.paths.join('\n') || undefined}
            >
              {workSummary(task.work)}
            </span>
          )}
          {!!task.steps?.length && (
            <span className="agent-task-steps text-muted-foreground text-caption overflow-hidden text-ellipsis whitespace-nowrap">
              {task.steps.map((step, index) => (
                <span key={index}>
                  {index > 0 && ' → '}
                  {providerName(step.provider)}
                  {step.model ? ` ${modelDisplayName(step.model)}` : ''}
                </span>
              ))}{' '}
              · {task.steps.at(-1)!.reason}
            </span>
          )}
        </span>
        <ChevronRight size={14} className={CARET_CLASS} />
      </Button>
      {actions.canStop && !readOnly && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={`${ICON_BUTTON_CLASS} agent-task-stop absolute top-[50%] right-3 [translate:0_-50%] text-muted-foreground`}
          aria-label={translate('Stop agent {0}', { '0': task.name })}
          title={translate('Stop this agent')}
          onClick={() => onStop(task)}
        >
          <Square size={12} />
        </Button>
      )}
    </div>
  )
}
