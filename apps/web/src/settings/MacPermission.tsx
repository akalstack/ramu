import { useState } from 'react'
import type { PrivacyPane } from '@ramu/shared/privacyPanes'
import { Button } from '@/components/desktop-button'
import { ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'

const PANE_NAMES: Record<PrivacyPane, string> = {
  'full-disk-access': 'Full Disk Access',
  accessibility: 'Accessibility',
  'screen-recording': 'Screen Recording',
  'input-monitoring': 'Input Monitoring',
  microphone: 'Microphone',
  camera: 'Camera',
}

/**
 * A macOS permission Ramu needs before it can go on: why, where to turn it on, a button that opens that exact page of
 * System Settings, and Check again for when the person comes back. Every permission need uses this, so none is left
 * as a bare "needs Full Disk Access" the person has to look up.
 */
export function MacPermission({
  pane,
  reason,
  onCheckAgain,
}: {
  pane: PrivacyPane
  reason: string
  onCheckAgain?: () => void
}) {
  useLanguage()
  const [error, setError] = useState('')
  const name = t(PANE_NAMES[pane])
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-m) bg-fill p-3 text-caption">
      <p className="m-0">{reason}</p>
      <p className="m-0 text-muted-foreground">
        {t(
          'In System Settings → Privacy & Security → {0}, turn on Ramu. macOS may ask Ramu to quit and reopen; your threads keep running.',
          { 0: name },
        )}
      </p>
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            setError('')
            void ramu.invoke('app.openPrivacySettings', pane).catch((reason) => setError(t(errorText(reason))))
          }}
        >
          {t('Open {0} settings', { 0: name })}
        </Button>
        {onCheckAgain && (
          <Button size="sm" variant="ghost" onClick={onCheckAgain}>
            {t('Check again')}
          </Button>
        )}
      </div>
    </div>
  )
}
