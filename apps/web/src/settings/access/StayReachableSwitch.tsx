import { Switch } from '@/components/ui/switch'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../../i18n'

/**
 * Whether the background service starts at login and outlives the app, so paired devices reach this host after a
 * restart. Choosing This network or Anywhere turns it on; this switch, under Advanced, turns it off again.
 */
export function StayReachableSwitch({
  checked,
  keepRunning,
  onChange,
}: {
  checked: boolean
  /** Whether the service already keeps running when Ramu closes; turning this on also keeps it running. */
  keepRunning: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsRow className="settings-toggle">
      <SettingsLabel
        title={t('Stay reachable after a restart')}
        help={
          keepRunning
            ? t('Start Ramu’s background service when you sign in, so your devices reach this host after a restart.')
            : t(
                'Keep the background service running when Ramu closes and start it when you sign in, so your devices reach this host.',
              )
        }
      />
      <Switch aria-label={t('Stay reachable after a restart')} checked={checked} onCheckedChange={onChange} />
    </SettingsRow>
  )
}
