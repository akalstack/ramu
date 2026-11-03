import { formatLocale, t, useLanguage } from '../../../i18n'
import { CircleCheck, CircleSlash, CircleX, Clock } from 'lucide-react'
import { providerName } from '../../../chat/AgentControls'
import type { AgentTask, AgentWork } from '@ramu/shared/types'
import { effortDisplayName, modelDisplayName } from '../../../models/ModelSets'
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
  // A working helper says so in words that shimmer, as tool rows do; no spinner beside them.
  if (status === 'running') return null
  if (status === 'completed') return <CircleCheck size={14} className="task-status completed" aria-hidden="true" />
  if (status === 'failed') return <CircleX size={14} className="task-status failed" aria-hidden="true" />
  return <CircleSlash size={14} className="task-status stopped" aria-hidden="true" />
}

/** A teammate named for its model (Sonnet 5.5 for `sonnet`) need not name the model again. */
const namesModel = (name: string, model: string) => name.toLowerCase().includes(modelDisplayName(model).toLowerCase())

/** Tool uses, time and tokens, as far as the provider reports them. */
export function taskMeta(task: AgentTask, status: AgentTask['status']): string {
  const duration =
    task.durationMs ??
    (task.startedAt && (task.endedAt ?? (status === 'running' ? Date.now() : undefined))
      ? (task.endedAt ?? Date.now()) - task.startedAt
      : undefined)
  return [
    task.provider
      ? `${providerName(task.provider)}${task.model && !namesModel(task.name, task.model) ? ` · ${modelDisplayName(task.model)}` : ''}`
      : undefined,
    task.effort ? effortDisplayName(task.effort, task.provider ?? 'claude-code') : undefined,
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

/** What the teammate changed and what it cost so far, e.g. "2 files +40 −5 · 3 turns · $0.12". */
export function workSummary(work: AgentWork): string {
  const changes = work.files
    ? `${work.files === 1 ? t('1 file') : t('{0} files', { 0: work.files })} +${work.added} −${work.removed}`
    : t('No changes')
  const turns = work.turns === 1 ? t('1 turn') : t('{0} turns', { 0: work.turns })
  const cost = work.costUsd
    ? [new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: 'USD' }).format(work.costUsd)]
    : []
  return [changes, turns, ...cost].join(' · ')
}
