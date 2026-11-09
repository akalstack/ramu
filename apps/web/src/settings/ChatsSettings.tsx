import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { EfficiencySettings } from './IntelligenceSettings'
import { Input } from '@/components/desktop-input'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SETTINGS_FORM_CLASS } from './constants'
import { ToggleRow, type DraftProps } from './ToggleRow'

export function ChatsSettings({ draft, onChange, busy }: DraftProps) {
  const toggleProps = { draft, onChange, busy }
  const setIntelligence = (intelligence: typeof draft.intelligence) => onChange({ ...draft, intelligence })
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Sending messages')}</SettingsGroupTitle>
      <SettingsRow setting="busyMessageAction">
        <SettingsLabel
          title={t('Messages while working')}
          help={t(
            'Steer adds your message after the current tools finish. Queue waits for the whole turn. Cmd/Ctrl+Enter does the other one.',
          )}
        />
        <Dropdown
          label={t('Messages while working')}
          value={draft.busyMessageAction}
          options={[
            { value: 'steer', label: t('Steer') },
            { value: 'queue', label: t('Queue') },
          ]}
          onChange={(value) => onChange({ ...draft, busyMessageAction: value === 'steer' ? 'steer' : 'queue' })}
        />
      </SettingsRow>
      <ToggleRow
        {...toggleProps}
        setting="warnModelChange"
        title="Warn before changing model"
        description="A new model can't reuse the cache of a conversation in progress, so the first message after switching uses more of your usage."
      />
      <ToggleRow
        {...toggleProps}
        setting="autoProjectSelection"
        title="Choose the project automatically"
        description="Home picks the project from your first message and asks when more than one fits. Turn off to always choose the project yourself."
      />
      <ToggleRow
        {...toggleProps}
        setting="includeTabContext"
        title="Include open tabs as context"
        description="Send the active file or selection with each message, plus the paths of other open tabs. Unsaved edits are included."
      />
      <SettingsGroupTitle>{t('While agents work')}</SettingsGroupTitle>
      <SettingsRow setting="hostDescription" className="settings-stack">
        <SettingsLabel
          title={t('Describe this host')}
          help={t(
            'A few words such as GPU box or office network. Continue on another host suggests it when a request mentions them.',
          )}
        />
        <Input
          aria-label={t('Describe this host')}
          maxLength={80}
          value={draft.hostDescription}
          onChange={(event) => onChange({ ...draft, hostDescription: event.target.value })}
        />
      </SettingsRow>
      <ToggleRow
        {...toggleProps}
        setting="agentThreads"
        title="Let agents start threads"
        description="Agents can start threads in this project, other projects and hosts added for agents. A paired host's agents can also start threads here. Sub-agents are not affected. Turn off so only you start threads."
      />
      <ToggleRow
        {...toggleProps}
        setting="teammateSuggestions"
        title="Let agents suggest teammates"
        description="The thread's agent may suggest bringing another model in, for example to review its work. Each suggestion asks you first and says which login it uses."
      />
      <ToggleRow
        {...toggleProps}
        setting="liveViewDesktop"
        title="Float on desktop"
        description="Browser, Computer and test device trays can float as a small live view in a corner or a window above other apps. Stop stays in reach."
      />
      <ToggleRow
        {...toggleProps}
        setting="notifyAgentDone"
        title="Agent notifications"
        description="Notify when an agent finishes, needs input, or fails."
      />
      <ToggleRow
        {...toggleProps}
        setting="resumeChatsOnRestart"
        title="Continue threads after restart"
        description="Resume unfinished threads when the service restarts. Stopped and completed threads stay stopped."
      />
      <ToggleRow
        {...toggleProps}
        setting="asyncQuestions"
        title="Keep working while asking questions"
        description="Let the agent continue independent work while it waits for your answer. Applies when a thread starts or restarts."
      />
      <SettingsGroupTitle>{t('Thread history')}</SettingsGroupTitle>
      <SettingsRow setting="recentChats">
        <SettingsLabel
          title={t('Recent threads per project')}
          help={t('Older threads stay available under Show more.')}
        />
        <Dropdown
          label={t('Recent threads per project')}
          value={String(draft.recentChats)}
          options={Array.from({ length: 18 }, (_, index) => ({
            value: String(index + 3),
            label: String(index + 3),
          }))}
          onChange={(value) => onChange({ ...draft, recentChats: Number(value) })}
        />
      </SettingsRow>
      <SettingsRow setting="cleanupArchivedDays">
        <SettingsLabel title={t('Delete archived threads after')} help={t('Worktrees and branches are kept.')} />
        <Dropdown
          label={t('Delete archived threads after')}
          value={String(draft.cleanupArchivedDays)}
          options={[
            { value: '0', label: t('Never') },
            { value: '7', label: t('7 days') },
            { value: '30', label: t('30 days') },
            { value: '90', label: t('90 days') },
            { value: '365', label: t('1 year') },
          ]}
          onChange={(value) => onChange({ ...draft, cleanupArchivedDays: Number(value) || 0 })}
        />
      </SettingsRow>
      <SettingsRow setting="autoBackgroundSeconds">
        <SettingsLabel
          title={t('Move slow commands to background')}
          help={t('Let the agent keep working when a command runs longer than this.')}
        />
        <Dropdown
          label={t('Move slow commands to background')}
          value={String(draft.autoBackgroundSeconds)}
          options={[
            { value: '0', label: t('Never') },
            { value: '30', label: t('After 30 seconds') },
            { value: '60', label: t('After 1 minute') },
            { value: '120', label: t('After 2 minutes') },
            { value: '300', label: t('After 5 minutes') },
          ]}
          onChange={(value) => onChange({ ...draft, autoBackgroundSeconds: Number(value) })}
        />
      </SettingsRow>
      <EfficiencySettings value={draft.intelligence} onChange={setIntelligence} />
    </div>
  )
}
