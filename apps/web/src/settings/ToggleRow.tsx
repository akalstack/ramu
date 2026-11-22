import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import type { AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'

export type ToggleKey =
  | 'previewTabs'
  | 'autoPull'
  | 'localCrashReports'
  | 'autoWatchPullRequests'
  | 'removeAgentCredits'
  | 'includeTabContext'
  | 'warnModelChange'
  | 'autoProjectSelection'
  | 'agentThreads'
  | 'modelCatalogLookups'
  | 'newModelNotices'
  | 'liveViewDesktop'
  | 'recapsEnabled'
  | 'notifyAgentDone'
  | 'resumeChatsOnRestart'
  | 'asyncQuestions'
  | 'suggestNextMessage'
  | 'showUsageLimits'
  | 'keepAwake'
  | 'fontSmoothing'
  | 'reduceMotion'
  | 'threadRowBranches'

export interface DraftProps {
  draft: AppPreferences
  onChange: (value: AppPreferences) => void
  busy: boolean
}

// A boolean preference row; title and description are translation keys.
export function ToggleRow({
  setting,
  title,
  description,
  draft,
  onChange,
  busy,
}: DraftProps & { setting: ToggleKey; title: string; description: string }) {
  return (
    <SettingsRow setting={setting}>
      <SettingsLabel title={t(title)} help={t(description)} />
      <Switch
        aria-label={t(title)}
        checked={draft[setting]}
        disabled={busy}
        onCheckedChange={(checked) => onChange({ ...draft, [setting]: checked })}
      />
    </SettingsRow>
  )
}
