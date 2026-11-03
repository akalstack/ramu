import { useState } from 'react'
import { Square, Users } from 'lucide-react'
import type { AgentModel, AgentSettings, AgentTask, TeammateMode } from '@ramu/shared/types'
import { teammateHandle } from '@ramu/shared/chat/agentTasks'
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

/** Above the composer while a teammate is here: who it is, how to address it, what it did so far, and Stop. */
export function TeammateBar({ sessionId, teammate }: { sessionId: string; teammate: AgentTask }) {
  useLanguage()
  const { invoke } = useHost()
  const handle = teammateHandle(teammate.name)
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-caption text-muted-foreground" role="status">
      <Users size={13} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('Teammate {0} · {1} · start a message with @{2} to talk to it', {
          0: teammate.name,
          1: teammate.teammate === 'review' ? t('Review') : t('Take over'),
          2: handle,
        })}
      </span>
      {teammate.work && (
        <span className="shrink-0 tabular-nums" title={teammate.work.paths.join('\n') || undefined}>
          {workSummary(teammate.work)}
        </span>
      )}
      {teammate.status === 'running' && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('Stop {0}', { 0: teammate.name })}
          onClick={() =>
            void invoke('agent.stopTask', sessionId, teammate.agentId).catch((error) => notifyError(errorText(error)))
          }
        >
          <Square size={11} />
        </Button>
      )}
    </div>
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
