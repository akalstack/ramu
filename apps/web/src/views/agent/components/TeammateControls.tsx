import { useState } from 'react'
import { Users } from 'lucide-react'
import { RowButton } from '@/components/row-button'
import { ComposerTraySection } from '../../../composer/ComposerTraySection'
import { ActivityText } from '../../../chat/ActivityText'
import { ProviderIcon } from '../../../models/ProviderIcon'
import type { AgentModel, AgentSettings, AgentTask, TeammateMode } from '@ramu/shared/types'
import { teammateHandle } from '@ramu/shared/chat/agentTasks'
import { helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { draftMention, joiningTeammate, modelHandle, type MentionTarget } from '@ramu/shared/chat/teammateMentions'
import type { CustomAgent } from '@ramu/shared/customAgents'
import { Menu } from '../../../Menu'
import { CHIP } from '../../../models/ProviderRoute'
import { Button } from '@/components/desktop-button'
import { AgentControls } from '../../../chat/AgentControls'
import { notifyError } from '../../../chat/Notifications'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'
import { workSummary } from './TaskStatus'

/** A model or custom agent the draft brings in: its settings start from the thread's and change in the composer. */
export interface JoiningTeammate {
  target: Extract<MentionTarget, { kind: 'model' | 'agent' }>
  name: string
  settings: AgentSettings
  mode: TeammateMode
  setSettings: (settings: AgentSettings) => void
  setMode: (mode: TeammateMode) => void
}

/**
 * While the draft starts with `@model` or `@custom-agent`, who joins and how: the thread's own settings on that model,
 * reviewing by default, or a custom agent's recipe. Choosing another model in the composer writes its `@handle` into the
 * draft, so what the message says and who receives it never disagree.
 */
export function useJoiningTeammate({
  draft,
  setDraft,
  base,
  teammates,
  models,
  agents,
}: {
  draft: string
  setDraft: (draft: string) => void
  /** The thread's settings; absent while it loads or on a device that may only view. */
  base: AgentSettings | undefined
  teammates: readonly AgentTask[]
  models: readonly AgentModel[]
  agents: readonly CustomAgent[]
}): JoiningTeammate | null {
  const found = base ? draftMention(draft, teammates, models, agents) : null
  const target = found && found.kind !== 'teammate' ? found : null
  const start = target && base ? joiningTeammate(target, base) : null
  const key = start?.key ?? ''
  const [edits, setEdits] = useState<{ key: string; settings?: AgentSettings; mode?: TeammateMode }>({ key: '' })
  if (!target || !start) return null
  const own = edits.key === key ? edits : { key }
  const settings = own.settings ?? start.settings
  const mode = own.mode ?? start.mode
  return {
    target,
    name: start.name,
    settings,
    mode,
    setMode: (next) => setEdits({ key, settings: own.settings, mode: next }),
    setSettings: (next) => {
      const model = models.find((entry) => entry.provider === next.provider && entry.id === next.model)
      const handle = model ? modelHandle(model) : null
      if (target.kind === 'model' && handle && `model:${handle}` !== key) {
        setEdits({ key: `model:${handle}`, settings: next, mode: own.mode })
        setDraft(draft.replace(/^@\S+/, `@${handle}`))
        return
      }
      setEdits({ key, settings: next, mode: own.mode })
    },
  }
}

/**
 * In the composer's controls while a message brings a teammate in: its model, effort and access, and whether it reviews
 * (reads and reports, never edits) or takes over (edits while the lead waits). The words of the message are its brief.
 */
export function TeammateJoinControls({ joining, disabled }: { joining: JoiningTeammate; disabled?: boolean }) {
  useLanguage()
  return (
    <AgentControls
      settings={joining.settings}
      onChange={joining.setSettings}
      disabled={disabled}
      trailing={
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t('How it works')}>
          {(['review', 'take-over'] as const).map((value) => (
            <Button
              key={value}
              role="radio"
              aria-checked={joining.mode === value}
              size="sm"
              variant={joining.mode === value ? 'secondary' : 'ghost'}
              disabled={disabled}
              title={
                value === 'review'
                  ? t(
                      'Reads the latest changes and replies with findings. It never edits, whatever this thread allows.',
                    )
                  : t('Edits while the lead waits, then hands back with a summary.')
              }
              onClick={() => joining.setMode(value)}
            >
              {value === 'review' ? t('Review') : t('Take over')}
            </Button>
          ))}
        </div>
      }
    />
  )
}

/**
 * The thread's teammates in the composer tray, beside its other live work: each one's model, how it works, what it
 * changed and cost, and Stop. Opening a row shows its conversation; the tooltip says how to address it.
 */
export function TeammatesSection({
  sessionId,
  teammates,
  onOpen,
  readOnly,
}: {
  sessionId: string
  teammates: AgentTask[]
  onOpen: (agentId: string) => void
  readOnly?: boolean
}) {
  useLanguage()
  const { invoke } = useHost()
  const working = teammates.filter((task) => task.status === 'running').length
  return (
    <ComposerTraySection
      aria-label={t('Teammates')}
      title={t('Teammates')}
      count={teammates.length}
      icon={<Users />}
      actions={
        working > 0 && (
          <ActivityText active className="text-caption text-muted-foreground">
            {t('{0} working', { 0: working })}
          </ActivityText>
        )
      }
    >
      <ul className="my-0 -mx-1.5 flex max-h-40 list-none flex-col overflow-y-auto overscroll-contain p-0">
        {teammates.map((task) => (
          <li key={task.agentId} className="flex min-h-8 items-center gap-2 text-control">
            <RowButton
              size="sm"
              stacked
              className="w-auto flex-1 min-w-0 px-1.5 py-1"
              title={t('Start a message with @{0} to talk to it', { 0: teammateHandle(task.name) })}
              onClick={() => onOpen(task.agentId)}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {task.provider ? <ProviderIcon provider={task.provider} size={13} /> : <Users size={13} />}
                <span className="truncate text-foreground">{task.name}</span>
                <span className="flex-none rounded-(--radius-s) bg-fill px-1.5 text-caption text-muted-foreground">
                  {task.teammate === 'take-over' ? t('Take over') : t('Review')}
                </span>
              </span>
              <span className="w-full truncate text-caption text-muted-foreground tabular-nums">
                <ActivityText active={task.status === 'running'}>{t(helperStatusLabel(task))}</ActivityText>
                {task.work ? ` · ${workSummary(task.work)}` : ''}
              </span>
            </RowButton>
            {task.status === 'running' && !readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-6 px-2 py-0 text-caption"
                aria-label={t('Stop {0}', { 0: task.name })}
                onClick={() =>
                  void invoke('agent.stopTask', sessionId, task.agentId).catch((error) => notifyError(errorText(error)))
                }
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

/**
 * Who a message without a mention goes to while the thread has teammates: the main agent, or the teammate last
 * talked to, so carrying on with it takes no `@`. Choosing here, or writing `@lead`, changes it.
 */
export function RecipientChip({
  teammates,
  recipient,
  onChange,
}: {
  teammates: AgentTask[]
  recipient: AgentTask | null
  onChange: (agentId: string | null) => void
}) {
  useLanguage()
  if (!teammates.length) return null
  const label = recipient ? t('To {0}', { 0: recipient.name }) : t('To the main agent')
  return (
    <Menu
      label={label}
      className={`${CHIP}${recipient ? ' on' : ''}`}
      icon={
        <>
          <Users size={13} aria-hidden="true" />
          <span className="max-w-[160px] truncate">{recipient ? recipient.name : t('Main agent')}</span>
        </>
      }
      items={[
        { key: 'lead', label: t('Main agent'), selected: !recipient, onSelect: () => onChange(null) },
        ...teammates.map((task) => ({
          key: task.agentId,
          label: task.name,
          selected: recipient?.agentId === task.agentId,
          onSelect: () => onChange(task.agentId),
        })),
      ]}
    />
  )
}
