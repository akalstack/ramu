import { RowButton } from '@/components/row-button'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { DateTime } from 'luxon'
import { useContext, useState } from 'react'
import type { IntelligencePreferences } from '@ramu/shared/types'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SettingsScopeContext, useSettingsInvoke } from '../settings/SettingsScope'
import { ownHostId } from '../hosts'
import { useHostSelection } from '../workspace/HostSelection'
import { nextSummaryAt, runMessage } from './summaryLogic'
import { useSummaries } from './useSummaries'
import { usePaged } from '../settings/cards'

type Props = { value: IntelligencePreferences; onChange: (value: IntelligencePreferences) => void; hasChanges: boolean }

const formatDate = (at: number) => DateTime.fromMillis(at).toLocaleString(DateTime.DATE_MED)

/** Settings → Memory & learning → What Ramu learned: how often, what to include, Run now, and the history. */
export function SummarySettings({ value, onChange, hasChanges }: Props) {
  const invoke = useSettingsInvoke()
  const scope = useContext(SettingsScopeContext)
  const { select } = useHostSelection()
  const { snapshot, reload } = useSummaries(invoke)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const off = value.summaryInterval === 'off'
  const run = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await invoke('summaries.run')
      await reload()
      setMessage(runMessage(result, formatDate, t))
    } catch (reason) {
      notifyError(errorText(reason), 'What Ramu learned')
    } finally {
      setBusy(false)
    }
  }
  const paged = usePaged(snapshot?.summaries ?? [], 5)
  const next = nextSummaryAt(value.summaryInterval, snapshot?.lastRunAt ?? null)
  return (
    <div className="settings-form flex flex-col gap-0 mt-6">
      <SettingsGroupTitle>{t('What Ramu learned')}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.summaryInterval">
        <SettingsLabel
          title={t('Summary')}
          help={t(
            'A short, read-only summary of the memories and skills Ramu saved, merged or archived on its own. Uses model tokens only when something changed.',
          )}
        />
        <Dropdown
          label={t('Summary')}
          value={value.summaryInterval}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'daily', label: t('Daily') },
            { value: 'weekly', label: t('Weekly') },
          ]}
          onChange={(summaryInterval) =>
            onChange({ ...value, summaryInterval: summaryInterval as IntelligencePreferences['summaryInterval'] })
          }
        />
      </SettingsRow>
      {!off && (
        <>
          <SettingsRow setting="intelligence.summaryMemory">
            <SettingsLabel title={t('Include memories')} help={t('Notes Ramu saved, merged or archived.')} />
            <Switch
              aria-label={t('Include memories')}
              checked={value.summaryMemory}
              onCheckedChange={(summaryMemory) => onChange({ ...value, summaryMemory })}
            />
          </SettingsRow>
          <SettingsRow setting="intelligence.summarySkills">
            <SettingsLabel title={t('Include skills')} help={t('Skills Ramu created, updated or archived.')} />
            <Switch
              aria-label={t('Include skills')}
              checked={value.summarySkills}
              onCheckedChange={(summarySkills) => onChange({ ...value, summarySkills })}
            />
          </SettingsRow>
        </>
      )}
      <div className="mb-4 mt-1 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          disabled={busy || snapshot?.running || off || hasChanges}
          title={hasChanges ? t('Save your changes first') : undefined}
          onClick={() => void run()}
        >
          {snapshot?.running ? t('Writing summary…') : t('Run now')}
        </Button>
        <span className="muted text-muted-foreground small text-caption" role="status">
          {message ??
            (snapshot?.error
              ? snapshot.error
              : next
                ? t('Next summary around {0}', { 0: formatDate(next) })
                : hasChanges
                  ? t('Save your changes first')
                  : '')}
        </span>
      </div>
      {paged.shown.length > 0 && (
        <ul className="m-0 mb-3 flex list-none flex-col gap-2 p-0" aria-label={t('Summaries')}>
          {paged.shown.map((summary) => (
            <li key={summary.id}>
              <RowButton
                size="lg"
                stacked
                className="gap-1 rounded-(--radius-m) bg-fill px-4 py-3 hover:bg-fill-hover"
                onClick={() => select(scope?.primaryId ?? ownHostId(), { kind: 'summary', summaryId: summary.id })}
              >
                <span className="flex w-full items-center gap-2 text-caption text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {[
                      `${formatDate(summary.periodStart)} – ${formatDate(summary.periodEnd)}`,
                      summary.status === 'dismissed' ? t('Dismissed') : null,
                      summary.chatIds.length > 0 ? t('Discussed in thread') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {summary.status === 'unread' && (
                    <span
                      role="img"
                      aria-label={t('Unread')}
                      className="inline-block size-2 flex-none rounded-full bg-[var(--accent)]"
                    />
                  )}
                </span>
                <span className="text-body text-foreground">{summary.headline}</span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      {paged.more}
      {snapshot && !snapshot.summaries.length && (
        <p className="muted text-muted-foreground small text-caption py-3">
          {t('No summaries yet. The first appears once there is something new to report.')}
        </p>
      )}
    </div>
  )
}
