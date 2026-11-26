import { useEffect, useState } from 'react'
import type { BackgroundStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { notifyError } from '../chat/Notifications'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'

/**
 * Once a device pairs during setup, the one thing that keeps it able to reach this host after a restart: the background
 * service starting at login, offered with one click. Nothing shows where it cannot be (another host, a system without
 * login items) or once it is on.
 */
export function StayReachable() {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useState<BackgroundStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void invoke('background.status').then(setStatus, () => {})
  }, [invoke])
  if (!status?.loginSupported || status.loginEnabled || status.keepRunning === undefined) return null
  const turnOn = async () => {
    setBusy(true)
    try {
      // Starting at login needs the service to outlive the app.
      if (!status.keepRunning) await invoke('background.keepRunning', true)
      await invoke('background.login', true)
      setStatus(await invoke('background.status'))
    } catch (cause) {
      notifyError(errorText(cause), t('Background service'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsRow>
      <SettingsLabel
        title={t('Stay reachable after a restart')}
        help={
          status.keepRunning
            ? t(
                'Start Ramu’s background service when you sign in, and keep this host awake while plugged in, so your devices reach it after a restart.',
              )
            : t(
                'Keep the background service running when Ramu closes, start it when you sign in, and keep this host awake while plugged in, so your devices reach it.',
              )
        }
      />
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void turnOn()}>
        {t('Turn on')}
      </Button>
    </SettingsRow>
  )
}
