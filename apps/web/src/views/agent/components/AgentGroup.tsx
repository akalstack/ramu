import { Spinner } from '@/components/ui/spinner'
import { t as translate, useLanguage } from '../../../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Bot, ChevronRight } from 'lucide-react'
import { summarizeAgentStatuses } from '@ramu/shared/ramuTools'
import { effectiveStatus } from '@ramu/shared/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { ProviderIcon } from '../../../models/ProviderIcon'
import { TASK_STATUS } from './TaskStatus'
import { AgentTaskCard } from './AgentTaskCard'
import { TOOL_DISCLOSURE_PANEL_CLASS } from '../styles'

/** Many sub-agents at once: stacked avatars and one status line that opens into each agent's card. */
export function AgentGroup({
  tasks,
  live,
  onOpen,
  onStop,
}: {
  tasks: AgentTask[]
  live: boolean
  onOpen: (agentId: string) => void
  onStop: (task: AgentTask) => void
}) {
  useLanguage()
  const statuses = tasks.map((task) => effectiveStatus(task, live))
  const running = statuses.includes('running')
  const failed = statuses.includes('failed')
  return (
    <Collapsible className="agent-group text-sm">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-(--radius-m) bg-raised px-3 py-2 text-sm font-normal hover:bg-fill"
          />
        }
      >
        <span className="flex flex-none items-center" aria-hidden="true">
          {tasks.slice(0, 3).map((task, index) => (
            <span
              key={task.agentId}
              className="grid size-6 place-items-center rounded-full bg-accent text-soft [box-shadow:0_0_0_2px_var(--raised)]"
              style={{ marginLeft: index === 0 ? 0 : -8 }}
            >
              {task.provider ? <ProviderIcon provider={task.provider} size={13} /> : <Bot size={13} />}
            </span>
          ))}
          {tasks.length > 3 && (
            <span
              className="grid size-6 place-items-center rounded-full bg-accent text-caption text-muted-foreground [box-shadow:0_0_0_2px_var(--raised)]"
              style={{ marginLeft: -8 }}
            >
              +{tasks.length - 3}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
          <span className="font-semibold text-foreground">{translate('{0} agents', { 0: tasks.length })}</span>
          <span className={`text-caption ${failed ? 'text-bad' : running ? 'text-brand' : 'text-muted-foreground'}`}>
            {summarizeAgentStatuses(statuses, (status) => translate(TASK_STATUS[status]).toLowerCase())}
          </span>
        </span>
        {running && <Spinner className="size-3.5 flex-none" aria-hidden="true" />}
        <ChevronRight
          size={14}
          className="caret flex-none text-muted-foreground [transition:transform_0.15s_var(--ease)] [[data-open]>_[data-slot='collapsible-trigger']_&]:[transform:rotate(90deg)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
        <div className="flex flex-col gap-1.5 pt-1.5">
          {tasks.map((task) => (
            <AgentTaskCard
              key={task.agentId}
              task={task}
              live={live}
              onOpen={() => onOpen(task.agentId)}
              onStop={onStop}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
