import { useEffect, useState } from 'react'
import type { PageInfo, PublicPageStatus } from '@ramu/shared/pages'
import { declaredCapabilities } from '@ramu/shared/pages'
import { Button } from '../components/desktop-button'
import { GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

/**
 * Open to anyone: the page on a hostname of its own through this host's tunnel tool, for people without Ramu. Only a
 * page that uses no host feature can be opened, and closing it ends its tunnel at once.
 */
export function PublicPageSection({ page }: { page: PageInfo }) {
  useLanguage()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [status, setStatus] = useState<PublicPageStatus | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const load = () =>
      void invoke('pages.publicStatus', page.id)
        .then(setStatus)
        .catch(() => {})
    load()
    return on('pages:changed', (payload) => {
      if (payload.pageId === page.id && !payload.run) load()
    })
  }, [invoke, on, page.id])
  const servable = declaredCapabilities(page.capabilities).length === 0
  const act = (work: Promise<unknown>) =>
    void work
      .then(() => invoke('pages.publicStatus', page.id).then(setStatus))
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e),
        ),
      )
  const open = status && status.state !== 'off'
  return (
    <section>
      <h4 className="m-0 mb-1.5 text-body font-medium text-foreground">{t('Open to anyone')}</h4>
      <p className="mt-0 mb-2 text-caption text-muted-foreground">
        {servable
          ? t(
              'Anyone with the link sees this page, without Ramu, while this host is on. It gets its own address through your Cloudflare or ngrok tool and serves only this page.',
            )
          : t('A page that keeps records or uses this host’s features cannot be opened to people without Ramu.')}
      </p>
      {open && (
        <div className="mb-2 flex items-center gap-1.5 text-caption">
          <span className="min-w-0 flex-1 truncate">
            {status.url ??
              (status.state === 'missing'
                ? t('Install cloudflared or ngrok on this host to open pages to anyone.')
                : status.state === 'failed'
                  ? (status.error ?? t('The tunnel stopped. Ramu tries again.'))
                  : t('Starting…'))}
          </span>
          {status.url && (
            <Button
              variant="ghost"
              className={GHOST_TEXT_BUTTON_CLASS}
              onClick={() => void navigator.clipboard?.writeText(status.url!)}
            >
              {t('Copy link')}
            </Button>
          )}
        </div>
      )}
      {servable && (
        <Button
          variant="outline"
          onClick={() => act(open ? invoke('pages.closePublic', page.id) : invoke('pages.openPublic', page.id))}
        >
          {open ? t('Close to everyone') : t('Open to anyone')}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-1.5 mb-0 text-caption text-bad">
          {error}
        </p>
      )}
    </section>
  )
}
