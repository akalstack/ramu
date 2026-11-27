import { useEffect, useState } from 'react'
import { SettingsGroupTitle } from '@/components/settings-row'
import type { AppPreferences } from '@ramu/shared/types'
import { BackgroundControls } from '../Automation'
import { t } from '../i18n'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { KeepAwakeSettings } from './KeepAwakeSettings'
import { useSettingsInvoke } from './SettingsScope'

export function SystemSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  const invoke = useSettingsInvoke()
  const toggleProps = { draft, onChange, busy }
  const [awakeSupported, setAwakeSupported] = useState(true)
  useEffect(() => {
    void invoke('background.keepAwake')
      .then((status) => setAwakeSupported(status.supported))
      .catch(() => {})
  }, [invoke])
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Background service')}</SettingsGroupTitle>
      <BackgroundControls onInstalled={() => onChange((current) => ({ ...current, keepAwake: true }))} />
      <KeepAwakeSettings {...toggleProps} supported={awakeSupported} />
    </div>
  )
}
