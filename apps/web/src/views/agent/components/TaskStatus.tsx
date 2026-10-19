import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '../../../i18n'
import { CircleCheck, CircleSlash, CircleX, Clock } from 'lucide-react'
import { providerName } from '../../../chat/AgentControls'
import type { AgentTask } from '@ramu/shared/types'
import { modelDisplayName } from '../../../models/ModelSets'
import { formatDuration } from '../lib/format'

/** Display name of each sub-agent status. */
export const TASK_STATUS: Record<AgentTask['status'], string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

/** The icon for a sub-agent status. */
export function TaskStatusIcon({ status, active = true }: { status: AgentTask['status']; active?: boolean }) {
  useLanguage()
  if (status === 'running' && !active) return <Clock size={14} aria-hidden="true" />
  if (status === 'running') return <Spinner className="size-3.5 task-status running" aria-hidden="true" />
  if (status === 'completed') return <CircleCheck size={14} className="task-status completed" aria-hidden="true" />
  if (status === 'failed') return <CircleX size={14} className="task-status failed" aria-hidden="true" />
  return <CircleSlash size={14} className="task-status stopped" aria-hidden="true" />
}

/** Tool uses, time and tokens, as far as the provider reports them. */
export function taskMeta(task: AgentTask, status: AgentTask['status']): string {
  const duration =
    task.durationMs ??
    (task.startedAt && (task.endedAt ?? (status === 'running' ? Date.now() : undefined))
      ? (task.endedAt ?? Date.now()) - task.startedAt
      : undefined)
  return [
    task.provider
      ? `${providerName(task.provider)}${task.model ? ` · ${modelDisplayName(task.model)}` : ''}`
      : undefined,
    task.effort,
    task.agentType,
    task.taskType === 'local_bash' ? 'Command' : undefined,
    task.isolated ? 'Own copy' : undefined,
    task.background ? 'Background' : undefined,
    task.toolUses ? `${task.toolUses} ${task.toolUses === 1 ? 'tool use' : 'tool uses'}` : undefined,
    duration ? formatDuration(duration) : undefined,
    task.tokens ? `${Math.round(task.tokens / 100) / 10}k tokens` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}
