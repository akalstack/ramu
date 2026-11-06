import { useEffect, useState } from 'react'
import type { PageInfo } from '@ramu/shared/pages'
import { Input } from '../components/desktop-input'
import { RowButton } from '../components/row-button'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'

type Target = 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages'

const TOKEN_HELP: Record<Exclude<Target, 'github-pages'>, string> = {
  netlify: 'https://app.netlify.com/user/applications#personal-access-tokens',
  vercel: 'https://vercel.com/account/tokens',
  'cloudflare-pages': 'https://dash.cloudflare.com/profile/api-tokens',
}

const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error)

/**
 * Publish to the web: the page's tested bytes as a static site on the person's own account. Choosing a platform and
 * pressing Publish is the approval; a page already live updates the same site.
 */
export function PublishDialog({ page, onClose }: { page: PageInfo; onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [targets, setTargets] = useState<{ target: Target; name: string; connected: boolean }[]>([])
  const [target, setTarget] = useState<Target>((page.published?.target as Target | undefined) ?? 'github-pages')
  const [token, setToken] = useState('')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void invoke('artifacts.publishTargets')
      .then(setTargets)
      .catch(() => {})
  }, [invoke])
  const chosen = targets.find((entry) => entry.target === target)
  const needsToken = !!chosen && !chosen.connected && target !== 'github-pages'
  const update = page.published?.target === target
  return (
    <Dialog
      title={update ? t('Update live site') : t('Publish to the web')}
      confirmLabel={busy ? t('Publishing…') : update ? t('Update live site') : t('Publish')}
      confirmDisabled={
        !chosen || (needsToken && token.trim().length < 8) || (target === 'github-pages' && !chosen.connected)
      }
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true)
        setError(null)
        void (async () => {
          if (needsToken)
            await invoke('artifacts.saveHostingToken', target as Exclude<Target, 'github-pages'>, token.trim())
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
                  : t('Needs a token')}
            </span>
          </RowButton>
        ))}
      </div>
      {needsToken && (
        <div className="mt-3 flex flex-col gap-1.5">
          <Input
            type="password"
            autoComplete="off"
            aria-label={t('{name} token', { name: chosen!.name })}
            placeholder={t('{name} token', { name: chosen!.name })}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          {target === 'cloudflare-pages' && (
            <Input
              autoComplete="off"
              aria-label={t('Cloudflare account ID (for a token limited to Pages)')}
              placeholder={t('Cloudflare account ID (for a token limited to Pages)')}
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            />
          )}
          <p className="m-0 text-caption text-muted-foreground">
            {t('Kept in this host’s credential store. Create one at {url}', {
              url: TOKEN_HELP[target as Exclude<Target, 'github-pages'>],
            })}
          </p>
        </div>
      )}
    </Dialog>
  )
}
