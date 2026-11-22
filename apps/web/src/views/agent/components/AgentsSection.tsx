import { Bot, List, SquareTerminal, Users } from 'lucide-react'
import { RowButton } from '@/components/row-button'
import { ComposerTraySection } from '../../../composer/ComposerTraySection'
import { ActivityText } from '../../../chat/ActivityText'
import { ProviderIcon } from '../../../models/ProviderIcon'
import type { AgentTask } from '@ramu/shared/types'
import { helperActive, helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../../i18n'
import { RoleTag, workSummary } from './TaskStatus'

/**
 * Everything working beside the main agent, in the composer tray: sub-agents still running and background
 * commands, each with its role, status and Stop. Opening a row shows its conversation; the list button shows every
 * agent this thread has had, finished ones included.
 */
export function AgentsSection({
  agents,
  onOpen,
  onOpenAll,
  onStop,
  readOnly,
}: {
  agents: AgentTask[]
  onOpen: (agentId: string) => void
  onOpenAll?: () => void
  onStop: (task: AgentTask) => void
  readOnly?: boolean
}) {
  useLanguage()
  const working = agents.filter(helperActive).length
  return (
    <ComposerTraySection
      aria-label={t('Agents')}
      title={t('Agents')}
      count={agents.length}
      icon={<Users />}
      actions={
        <>
          {working > 0 && (
            <ActivityText active className="text-caption text-muted-foreground">
              {t('{0} working', { 0: working })}
            </ActivityText>
          )}
          {onOpenAll && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('All agents')}
              title={t('All agents in this thread')}
              onClick={onOpenAll}
            >
              <List size={13} />
            </Button>
          )}
        </>
      }
    >
      <ul className="my-0 -mx-1.5 flex max-h-40 list-none flex-col overflow-y-auto overscroll-contain p-0">
        {agents.map((task) => (
          <li key={task.agentId} className="flex min-h-8 items-center gap-2 text-control">
            <RowButton
              size="sm"
              stacked
              className="w-auto flex-1 min-w-0 px-1.5 py-1"
              onClick={() => onOpen(task.agentId)}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {task.taskType === 'local_bash' ? (
                  <SquareTerminal size={13} />
                ) : task.provider ? (
                  <ProviderIcon provider={task.provider} size={13} />
                ) : (
                  <Bot size={13} />
                )}
                <span className="truncate text-foreground">{task.name}</span>
                <RoleTag task={task} />
              </span>
              <span className="w-full truncate text-caption text-muted-foreground tabular-nums">
                <ActivityText active={helperActive(task)}>{t(helperStatusLabel(task))}</ActivityText>
                {task.work ? ` · ${workSummary(task.work)}` : ''}
              </span>
            </RowButton>
            {helperActive(task) && !readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-6 px-2 py-0 text-caption"
                aria-label={t('Stop {0}', { 0: task.name })}
                onClick={() => onStop(task)}
              >
                {t('Stop')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </ComposerTraySection>
  )
}
