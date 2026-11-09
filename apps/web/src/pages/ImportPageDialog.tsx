import { useState } from 'react'
import { parseArtifactLink } from '@ramu/shared/artifacts'
import { Input } from '../components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { invokerFor } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { openPage } from './openPage'

/**
 * Copies an artifact another connected host shared into this host: its code and capabilities as a new artifact, with
 * none of its records or values. The share link must be from a host this desktop is connected to.
 */
export function ImportPageDialog({ onClose }: { onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const found = parseArtifactLink(link)
  const parsed = found?.share ? { host: found.computerId, token: found.share } : null
  return (
    <Dialog
      title={t('Import an artifact')}
      confirmLabel={t('Import')}
      confirmDisabled={!parsed}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        if (!parsed) return
        setBusy(true)
        setError(null)
        void invokerFor(parsed.host)('artifacts.openShare', parsed.token)
          .then(async (shared) => {
            const from = { title: shared.artifact.title, icon: shared.artifact.icon }
            const page = await invoke('artifacts.import', shared.document, from)
            onClose()
            openPage(page.id)
          })
          .catch((e: unknown) =>
            setError(
              e instanceof Error
                ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
                : t('Could not import that artifact.'),
            ),
          )
          .finally(() => setBusy(false))
      }}
    >
      <p>
        {t(
          'Paste a share link from another host this desktop is connected to. The artifact’s code comes over; its records and values stay there.',
        )}
      </p>
      <Input
        autoFocus
        aria-label={t('Share link')}
        placeholder="ramu://artifact/…"
        value={link}
        onChange={(event) => setLink(event.target.value)}
      />
    </Dialog>
  )
}
