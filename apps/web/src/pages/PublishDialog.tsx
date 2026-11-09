import { useEffect, useState } from 'react'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { RowButton } from '../components/row-button'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'

type Target = 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages'

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)

/**
 * Publish to the web: the page's tested bytes as a static site on the person's own account. Choosing a platform and
 * pressing Publish is the approval; a page already live updates the same site.
 */
export function PublishDialog({ page, onClose }: { page: ArtifactInfo; onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [targets, setTargets] = useState<{ target: Target; name: string; connected: boolean }[]>([])
  const [target, setTarget] = useState<Target>((page.published?.target as Target | undefined) ?? 'github-pages')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void invoke('artifacts.publishTargets')
      .then(setTargets)
      .catch(() => {})
  }, [invoke])
  const chosen = targets.find((entry) => entry.target === target)
  // Netlify, Vercel and Cloudflare Pages are connected once in Settings and shared with deploys.
  const needsAccount = !!chosen && !chosen.connected && target !== 'github-pages'
  const update = page.published?.target === target
  return (
    <Dialog
      title={update ? t('Update live site') : t('Publish to the web')}
      confirmLabel={busy ? t('Publishing…') : update ? t('Update live site') : t('Publish')}
      confirmDisabled={!chosen || needsAccount || (target === 'github-pages' && !chosen.connected)}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true)
        setError(null)
        void (async () => {
          await invoke('artifacts.publish', page.id, target)
          onClose()
        })()
          .catch((e) => setError(message(e)))
          .finally(() => setBusy(false))
      }}
    >
      <p>
        {update
          ? t('Deploys v{version} to {url}.', { version: page.version, url: page.published!.url })
          : t('Deploys this page as a static site on your own account. Ramu hosts nothing.')}
      </p>
      <div role="radiogroup" aria-label={t('Where')} className="flex flex-col gap-0.5">
        {targets.map((entry) => (
          <RowButton
            key={entry.target}
            role="radio"
            aria-checked={target === entry.target}
            aria-pressed={target === entry.target}
            onClick={() => setTarget(entry.target)}
          >
            <span className="flex-1 text-foreground">{entry.name}</span>
            <span className="text-caption text-muted-foreground">
              {entry.connected
                ? t('Connected')
                : entry.target === 'github-pages'
                  ? t('Connect GitHub in Settings → Git hosting')
                  : t('Connect it in Settings → Deploy')}
            </span>
          </RowButton>
        ))}
      </div>
    </Dialog>
  )
}
