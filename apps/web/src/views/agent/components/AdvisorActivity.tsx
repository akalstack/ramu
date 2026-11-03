import { useEffect } from 'react'
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { useHost } from '../../../workspace/HostProvider'
import { useHostConnection } from '../../../workspace/computers'
import { t as translate, useLanguage } from '../../../i18n'
import { ChevronRight } from 'lucide-react'
import { ChatActivityButton } from '../../../chat/ChatActivity'
import { providerName } from '../../../chat/AgentControls'
import { effectiveStatus } from '@ramu/shared/chat/agentTasks'
import type { AgentTask } from '@ramu/shared/types'
import { modelDisplayName } from '../../../models/ModelSets'
import { ActivityText } from '../../../chat/ActivityText'
import { formatDuration } from '../lib/format'
import { useElapsed } from '../hooks/useElapsed'
import { TaskStatusIcon } from './TaskStatus'

const marking = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * A consultation remains visible in the main chat even with Agents closed. A settled one showing in an open transcript
 * counts as seen: the host clears the thread's unread-advice count (one call per session, however many cards show).
 */
export function AdvisorActivity({
  task,
  live,
  onOpen,
  sessionId,
}: {
  task: AgentTask
  live: boolean
  onOpen: () => void
  sessionId?: string
}) {
  useLanguage()
  const { offline } = useHostConnection()
  const { id: host, invoke } = useHost()
  const status = effectiveStatus(task, live)
  const settled = status === 'completed' || status === 'failed'
  useEffect(() => {
    if (!settled || !sessionId || offline) return
    const key = `${host}:${sessionId}`
    clearTimeout(marking.get(key))
    marking.set(
      key,
      setTimeout(() => {
        marking.delete(key)
        // A view-only device is refused, which needs no saying.
        void Promise.resolve(invoke('agent.markAdviceRead', sessionId)).catch(() => {})
      }, 600),
    )
  }, [settled, sessionId, offline, host, invoke])
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
      <TaskStatusIcon status={status} active={!offline && helperActive(task) && !task.waitingFor} />
      <span role="status">
        <ActivityText active={!offline && helperActive(task) && !task.waitingFor}>
          {offline ? `${translate('Last known')} · ` : ''}
          {translate(label)}
        </ActivityText>
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
