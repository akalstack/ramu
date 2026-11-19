import { useEffect, useState } from 'react'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { openHostingSettings } from '../sidebar/scm/ForgeAccessPanel'

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)

/**
 * Publish to the web: the page's tested bytes as a static site on GitHub Pages, through the person's own GitHub login.
 * Pressing Publish is the approval; a page already live there updates the same site.
 */
export function PublishDialog({ page, onClose }: { page: ArtifactInfo; onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [ready, setReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void invoke('artifacts.publishReady')
      .then(setReady)
      .catch(() => setReady(false))
  }, [invoke])
  const update = page.published?.target === 'github-pages'
  return (
    <Dialog
      title={update ? t('Update live site') : t('Publish to the web')}
      confirmLabel={busy ? t('Publishing…') : update ? t('Update live site') : t('Publish')}
      confirmDisabled={!ready}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true)
        setError(null)
        void (async () => {
          await invoke('artifacts.publish', page.id)
          onClose()
        })()
          .catch((e) => setError(message(e)))
          .finally(() => setBusy(false))
      }}
    >
      <p>
        {update
          ? t('Deploys v{version} to {url}.', { version: page.version, url: page.published!.url })
          : t('Deploys this artifact to GitHub Pages on your own account. Ramu hosts nothing.')}
      </p>
      {ready === false && (
        <span>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              onClose()
              openHostingSettings()
            }}
          >
            {t('Connect {0}', { 0: 'GitHub' })}
          </Button>
        </span>
      )}
    </Dialog>
  )
}
