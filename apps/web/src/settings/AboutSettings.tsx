import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, Bug, ExternalLink, Lightbulb, Scale } from 'lucide-react'
import type { AppPreferences } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { AnimatedMark } from '../Brand'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { copyText, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { AppUpdates } from './AppUpdates'
import { REPO, SITE, bugReportUrl, releaseNotesUrl } from './aboutLinks'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { useSettingsInvoke } from './SettingsScope'
import { ToggleRow } from './ToggleRow'

const open = (url: string) => void ramu.invoke('app.openExternal', url).catch(() => {})

/** One link out: a title and line on what it is, opening in the browser. */
function LinkRow({ icon, title, help, url }: { icon: ReactNode; title: string; help: string; url: string }) {
  return (
    <SettingsRow>
      <SettingsLabel icon={icon} title={title} help={help} />
      <Button variant="secondary" size="sm" onClick={() => open(url)}>
        <ExternalLink size={13} />
        {t('Open')}
      </Button>
    </SettingsRow>
  )
}

/**
 * Settings › About: which Ramu this is and its updates, where to get help or report a problem, the diagnostics a report
 * can carry, and the license. Updates and diagnostics are per host, so they follow the host the page shows.
 */
export function AboutSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    void invoke('updates.status').then(
      (status) => setVersion(status.currentVersion),
      () => {},
    )
  }, [invoke])
  const platform = navigator.userAgent.includes('Mac') ? 'macOS' : 'Linux'
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <div className="mb-5 flex items-center gap-4 rounded-(--radius-m) bg-fill px-4 py-4">
        <AnimatedMark size={52} />
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="text-[17px] font-semibold">Ramu</strong>
          <span className="text-caption text-muted-foreground">
            {version ? t('Version {0} · Alpha', { 0: version }) : t('Alpha')}
          </span>
          <span className="text-control text-muted-foreground">
            {t('Work with AI agents on any of your computers, from anywhere.')}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => open(releaseNotesUrl(version))}>
              {t('What’s new')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => open(SITE)}>
              getramu.dev
            </Button>
          </div>
        </div>
      </div>

      <SettingsGroupTitle>{t('Updates')}</SettingsGroupTitle>
      <AppUpdates value={draft} onChange={onChange} />

      <SettingsGroupTitle className="mt-4">{t('Help & feedback')}</SettingsGroupTitle>
      <div>
        <LinkRow
          icon={<BookOpen size={14} />}
          title={t('Documentation')}
          help={t('Guides to every feature, from remote access to plugins.')}
          url={`${REPO}/tree/main/docs/guide`}
        />
        <LinkRow
          icon={<Bug size={14} />}
          title={t('Report a problem')}
          help={t('Opens an issue with this version and system filled in. Copy diagnostics below to attach them.')}
          url={bugReportUrl(version, platform)}
        />
        <LinkRow
          icon={<Lightbulb size={14} />}
          title={t('Share an idea')}
          help={t('Talk a feature through with the team before anyone builds it.')}
          url={`${REPO}/discussions/categories/ideas`}
        />
        <LinkRow
          icon={<BrandIcon brand="github" size={14} />}
          title={t('Source code')}
          help={t('Ramu is open source. Read it, build it, or contribute.')}
          url={REPO}
        />
      </div>

      <SettingsGroupTitle className="mt-4">{t('Diagnostics')}</SettingsGroupTitle>
      <ToggleRow
        draft={draft}
        onChange={onChange}
        busy={busy}
        setting="localCrashReports"
        title="Keep local crash reports"
        description="Off by default. Keeps sanitized service errors and Electron crash dumps on this device, never uploaded. Restart Ramu to apply. Native dumps may hold process memory and are left out of copied diagnostics."
      />
      <div className="mb-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void invoke('diagnostics.export')
              .then(copyText)
              .catch((e) => notifyError(errorText(e)))
          }
        >
          {t('Copy sanitized diagnostics')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void invoke('diagnostics.clear').catch((e) => notifyError(errorText(e)))}
        >
          {t('Clear diagnostics')}
        </Button>
      </div>

      <SettingsGroupTitle>{t('Legal')}</SettingsGroupTitle>
      <LinkRow
        icon={<Scale size={14} />}
        title={t('License')}
        help={t('Ramu is free software under the MIT License, made by Akalstack and its contributors.')}
        url={`${REPO}/blob/main/LICENSE`}
      />
    </div>
  )
}
