import { useEffect, useState } from 'react'
import { LINK_TARGET_KEY, linkTargetFrom } from '@ramu/shared/browserLinks'
import type { LinkTarget } from '@ramu/shared/browser'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { deviceStorage } from '../deviceStorage'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'

/** Settings → Browser. Where clicked links open is a choice of this device; it follows the person across hosts. */
export function BrowserSettings() {
  useLanguage()
  const [target, setTarget] = useState<LinkTarget>(() => linkTargetFrom(deviceStorage.getItem(LINK_TARGET_KEY)))
  useEffect(
    () =>
      deviceStorage.subscribe(
        (key) => key === LINK_TARGET_KEY && setTarget(linkTargetFrom(deviceStorage.getItem(LINK_TARGET_KEY))),
      ),
    [],
  )
  return (
    <div className="settings-form flex flex-col gap-3">
      <SettingsGroupTitle>{t('Links & viewing')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel
          title={t('Open clicked links in')}
          help={t(
            'Applies to this device only. Links always open in your own browser when no thread is open. Right-click is not changed.',
          )}
        />
        <Dropdown
          label={t('Open clicked links in')}
          value={target}
          options={[
            { value: 'system', label: t('System browser') },
            { value: 'integrated', label: t('Ramu browser (in the thread)') },
          ]}
          onChange={(value) => deviceStorage.setItem(LINK_TARGET_KEY, linkTargetFrom(value))}
        />
      </SettingsRow>
      <p className="m-0 text-caption text-muted-foreground">
        {t('The Ramu browser keeps its own sign-ins, separate from your system browser and from your threads.')}
      </p>
    </div>
  )
}
