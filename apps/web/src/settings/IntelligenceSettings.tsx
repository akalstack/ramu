import { MovedToCustomize } from '../customize/openCustomize'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { SettingsAdvanced, SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { ModelChoice } from './ModelChoice'
import { type IntelligencePreferences, type MemoryPreferences, type LearningSnapshot } from '@ramu/shared/types'

type Props = { value: IntelligencePreferences; onChange: (value: IntelligencePreferences) => void }
const withCurrent = (values: number[], current: number) => [...new Set([...values, current])].sort((a, b) => a - b)

export function EfficiencySettings({ value, onChange }: Props) {
  return (
    <>
      <SettingsGroupTitle>{t('Token efficiency')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.toolSearch">
        <SettingsLabel
          title={t('Load tools on demand')}
          help={t(
            'For providers without their own tool search (Antigravity and Cursor), keep optional Ramu tools out of the prompt until the agent needs them. Claude, Codex and OpenCode always do this themselves. Applies to new provider sessions.',
          )}
        />
        <Switch
          aria-label={t('Load tools on demand')}
          checked={value.toolSearch}
          onCheckedChange={(toolSearch) => onChange({ ...value, toolSearch })}
        />
      </SettingsRow>
    </>
  )
}

/** One model for the background work of both memory cleanup and learning reviews. */
export function MaintenanceModelSettings({ value, onChange, cleanup }: Props & { cleanup: boolean }) {
  if (value.learning === 'off' && !cleanup) return null
  return (
    <div className="settings-form flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Background model')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.maintenanceModel">
        <SettingsLabel
          title={t('Model for background maintenance')}
          help={t('Used for learning reviews and memory cleanup. A cheaper model keeps token use low.')}
        />
        <ModelChoice
          label={t('Model for background maintenance')}
          value={value.maintenanceModel}
          emptyLabel={t('Same as thread')}
          onChange={(maintenanceModel) => onChange({ ...value, maintenanceModel })}
        />
      </SettingsRow>
    </div>
  )
}

/** Limits on background learning. */
function LearningLimitsSettings({ value, onChange }: Props) {
  if (value.learning === 'off') return null
  return (
    <>
      <SettingsRow setting="intelligence.dailyReviews">
        <SettingsLabel title={t('Reviews per day')} help={t('Caps background reviews to limit token use.')} />
        <Dropdown
          label={t('Reviews per day')}
          value={String(value.dailyReviews)}
          options={withCurrent([1, 3, 5, 10, 20], value.dailyReviews).map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          onChange={(n) => onChange({ ...value, dailyReviews: Number(n) })}
        />
      </SettingsRow>
      <SettingsRow setting="intelligence.archiveSkillDays">
        <SettingsLabel
          title={t('Archive unused skills after')}
          help={t('Only skills Ramu created are archived. Pinned skills are kept.')}
        />
        <Dropdown
          label={t('Archive unused skills after')}
          value={String(value.archiveSkillDays)}
          options={withCurrent([30, 60, 90, 180, 365], value.archiveSkillDays).map((days) => ({
            value: String(days),
            label: t('{0} days', { 0: days }),
          }))}
          onChange={(days) => onChange({ ...value, archiveSkillDays: Number(days) })}
        />
      </SettingsRow>
    </>
  )
}

/**
 * The Memory page's tuning, folded under Advanced: how long unused memories and skills are kept, and how many learning
 * reviews run a day.
 */
export function MemoryAdvancedSettings({
  memory,
  intelligence,
  onMemory,
  onIntelligence,
}: {
  memory: MemoryPreferences
  intelligence: IntelligencePreferences
  onMemory: (value: MemoryPreferences) => void
  onIntelligence: (value: IntelligencePreferences) => void
}) {
  if (!memory.enabled && intelligence.learning === 'off') return null
  return (
    <div className="settings-form flex flex-col gap-0">
      <SettingsAdvanced>
        {memory.enabled && (
          <SettingsRow setting="memory.staleAfterDays">
            <SettingsLabel
              title={t('Archive unused memories after')}
              help={t(
                'Applies to project notes that were never used. Notes you wrote and essential memories are kept.',
              )}
            />
            <Dropdown
              label={t('Archive unused memories after')}
              value={String(memory.staleAfterDays)}
              options={[...new Set([30, 60, 90, 180, 365, memory.staleAfterDays])]
                .sort((a, b) => a - b)
                .map((days) => ({ value: String(days), label: t('{0} days', { 0: days }) }))}
              onChange={(days) => onMemory({ ...memory, staleAfterDays: Number(days) })}
            />
          </SettingsRow>
        )}
        <LearningLimitsSettings value={intelligence} onChange={onIntelligence} />
      </SettingsAdvanced>
    </div>
  )
}

/** The learning snapshot, refreshed whenever memory changes, with one guarded way to change it. */
function useLearning() {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const host = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
  const access = useRef({ host, viewOnly, version: 0 })
  if (access.current.host !== host || access.current.viewOnly !== viewOnly)
    access.current = { host, viewOnly, version: access.current.version + 1 }
  const reads = useRef(0)
  const [snapshot, setSnapshot] = useState<{ host: string; value: LearningSnapshot } | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    if (viewOnly || access.current.host !== host || access.current.viewOnly) return
    const version = access.current.version
    const request = ++reads.current
    try {
      const value = await invoke('learning.get')
      if (
        access.current.host === host &&
        access.current.version === version &&
        request === reads.current &&
        !access.current.viewOnly
      )
        setSnapshot({ host, value })
    } catch (reason) {
      if (access.current.host === host && access.current.version === version && request === reads.current) throw reason
    }
  }, [invoke, host, viewOnly])
  useEffect(() => {
    setBusy(false)
    if (viewOnly) return
    void reload().catch((e) => notifyError(errorText(e), 'Learning'))
    return on('memory:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload, on, viewOnly])
  const act = async (fn: () => Promise<unknown>) => {
    if (access.current.host !== host || access.current.viewOnly) return
    const version = access.current.version
    setBusy(true)
    try {
      await fn()
      if (access.current.version === version) await reload()
    } catch (e) {
      if (access.current.version === version) notifyError(errorText(e), 'Learning')
    } finally {
      if (access.current.version === version) setBusy(false)
    }
  }
  return { invoke, snapshot: snapshot?.host === host ? snapshot.value : null, busy, act, viewOnly }
}

/**
 * How Ramu learns: recall, automatic learning and one way to tidy up now. Reviews waiting for the person are in Inbox →
 * Learned and under the turn they learned from; the skills it learned are in Customize → Skills.
 */
export function LearningSettings({ value, onChange, memory }: Props & { memory: boolean }) {
  const { invoke, snapshot, busy, act, viewOnly } = useLearning()
  const learning = value.learning !== 'off'
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('Learning & skills')}</SettingsGroupTitle>
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <SettingsRow setting="intelligence.crossThreadRecall">
        <SettingsLabel
          title={t('Recall past conversations')}
          help={t(
            'Let agents search earlier threads across providers. Turning this off keeps your history and same-thread recall. Applies when a thread starts or restarts.',
          )}
        />
        <Switch
          aria-label={t('Recall past conversations')}
          checked={value.crossThreadRecall}
          onCheckedChange={(crossThreadRecall) => onChange({ ...value, crossThreadRecall })}
        />
      </SettingsRow>
      <SettingsRow setting="intelligence.learning">
        <SettingsLabel
          title={t('Automatic learning')}
          help={t(
            'When a thread’s task is finished, save lasting notes and reusable skills. Uses model tokens when idle.',
          )}
        />
        <Dropdown
          label={t('Automatic learning')}
          value={value.learning}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'review', label: t('Ask me first') },
            { value: 'auto', label: t('Save automatically') },
          ]}
          onChange={(learning) => onChange({ ...value, learning: learning as IntelligencePreferences['learning'] })}
        />
      </SettingsRow>
      <div className="mt-3 mb-1 flex flex-wrap items-center gap-3">
        <Button
          disabled={viewOnly || busy || snapshot?.running || (!learning && !memory)}
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          onClick={() =>
            // Learning first, so memory cleanup also sees the notes the reviews just saved.
            void act(async () => {
              if (learning) await invoke('learning.run')
              if (memory) await invoke('memory.dream')
            })
          }
        >
          {busy || snapshot?.running ? t('Tidying up…') : t('Tidy up now')}
        </Button>
        <span className="text-caption text-muted-foreground">
          {t('Review finished threads and clean up memory now, instead of waiting for idle time.')}
        </span>
      </div>
      <MovedToCustomize
        section="skills"
        text={t('Skills Ramu learned, with their history, are in Customize → Skills.')}
      />
    </div>
  )
}
