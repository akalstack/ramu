import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { useHostConnection } from '../../../workspace/computers'
import { Spinner } from '@/components/ui/spinner'
import { t as translate, useLanguage } from '../../../i18n'
import { ChevronRight } from 'lucide-react'
import { ChatActivityButton } from '../../../chat/ChatActivity'
import { providerName } from '../../../chat/AgentControls'
import { effectiveStatus } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { modelDisplayName } from '../../../models/ModelSets'
import { formatDuration } from '../lib/format'
import { useElapsed } from '../hooks/useElapsed'
import { TaskStatusIcon } from './TaskStatus'

/** A consultation remains visible in the main chat even with Agents closed. */
export function AdvisorActivity({ task, live, onOpen }: { task: AgentTask; live: boolean; onOpen: () => void }) {
  useLanguage()
  const { offline } = useHostConnection()
  const status = effectiveStatus(task, live)
  const elapsed = useElapsed(task.startedAt, !offline && helperActive(task))
  const label =
    task.waitingFor === 'provider' && status === 'running'
      ? 'Advisor waiting for provider'
      : status === 'running'
        ? 'Consulting advisor…'
        : status === 'completed'
          ? 'Advisor finished'
          : status === 'failed'
            ? 'Advisor failed'
            : 'Advisor stopped'
  const duration = elapsed ?? (task.endedAt && task.startedAt ? task.endedAt - task.startedAt : null)
  return (
    <ChatActivityButton
      type="button"
      className={`advisor-activity ${status}`}
      onClick={onOpen}
      title={task.error ?? translate("Open the advisor's answer")}
    >
      {!offline && helperActive(task) && !task.waitingFor ? (
        <Spinner className="size-3.5 flex-none" />
      ) : (
        <TaskStatusIcon status={status} active={!offline && helperActive(task) && !task.waitingFor} />
      )}
      <span role="status">
        {offline ? `${translate('Last known')} · ` : ''}
        {translate(label)}
      </span>
      {(task.model || task.provider) && (
        <span className="chat-activity-meta truncate">
          {task.model ? modelDisplayName(task.model) : providerName(task.provider!)}
        </span>
      )}
      {duration !== null && (
        <span className="chat-activity-meta flex-none tabular-nums">{formatDuration(duration)}</span>
      )}
      <ChevronRight className="size-3.5 flex-none" />
    </ChatActivityButton>
  )
}
