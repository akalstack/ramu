import { useState } from 'react'
import { Input } from '../components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { invokerFor } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { openPage } from './openPage'

/** `ramu://page/<host>/<page>?share=<token>`, as Share links copy. */
export function parseShareLink(text: string): { host: string; pageId: string; token: string } | null {
  const match = /^ramu:\/\/page\/([^/?#]{1,120})\/([\w-]{1,80})\?share=([\w-]{8,80})$/.exec(text.trim())
  return match ? { host: decodeURIComponent(match[1]!), pageId: match[2]!, token: match[3]! } : null
}

/**
 * Copies a page another connected host shared into this host: its code and capabilities as a new page, with none of
 * its records or values. The share link must be from a host this desktop is connected to.
 */
export function ImportPageDialog({ onClose }: { onClose(): void }) {
  useLanguage()
  const { invoke } = useHost()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseShareLink(link)
  return (
    <Dialog
      title={t('Import a page')}
      confirmLabel={t('Import')}
      confirmDisabled={!parsed}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        if (!parsed) return
        setBusy(true)
        setError(null)
        void invokerFor(parsed.host)('pages.openShare', parsed.token)
          .then((shared) =>
            invoke('pages.import', shared.document, { title: shared.page.title, icon: shared.page.icon }),
          )
          .then((page) => {
            onClose()
            openPage(page.id)
          })
          .catch((e: unknown) =>
            setError(
              e instanceof Error
                ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
                : t('Could not import that page.'),
            ),
          )
          .finally(() => setBusy(false))
      }}
    >
      <p>
        {t(
          'Paste a share link from another host this desktop is connected to. The page’s code comes over; its records and values stay there.',
        )}
      </p>
      <Input
        autoFocus
        aria-label={t('Share link')}
        placeholder="ramu://page/…"
        value={link}
        onChange={(event) => setLink(event.target.value)}
      />
    </Dialog>
  )
}
