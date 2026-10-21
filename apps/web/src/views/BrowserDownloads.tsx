import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { BrowserDownloadInfo } from '@ramu/shared/browserBridge'
import { Button } from '@/components/desktop-button'
import { ramu } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'

export function BrowserDownloads({
  host,
  taskId,
  tabId,
  human,
}: {
  host: string
  taskId: string
  tabId?: string
  human: boolean
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<BrowserDownloadInfo[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    let revision = 0
    setEntries([])
    setMessage('')
    const refresh = async () => {
      const mine = ++revision
      try {
        const next = await ramu.invoke('browser.downloads', host, taskId)
        if (active && mine === revision) setEntries(next)
      } catch (error) {
        if (active && mine === revision && open) setMessage(t(errorText(error)))
      }
    }
    void refresh()
    const off = ramu.on('browser:changed', () => void refresh())
    return () => {
      active = false
      off()
    }
  }, [host, taskId, open])
  const act = async (work: () => Promise<unknown>, success = '') => {
    setBusy(true)
    setMessage('')
    try {
      await work()
      setMessage(success)
    } catch (error) {
      setMessage(t(errorText(error)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border-b border-border text-caption">
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Download size={14} />
        {t('Downloads')}
        {entries.length ? ` (${entries.length})` : ''}
      </Button>
      {open && (
        <div className="max-h-48 overflow-auto px-3 pb-2">
          <p className="text-muted-foreground">
            {t(
              'Allow one download, then click its link. Files expire after one hour and are never opened automatically.',
            )}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={!human || !tabId || busy}
            onClick={() =>
              tabId &&
              void act(
                () => ramu.invoke('browser.allowDownload', host, taskId, tabId),
                t('Next download allowed for 60 seconds.'),
              )
            }
          >
            {t('Allow next download')}
          </Button>
          {!human && <p className="text-muted-foreground">{t('Take control to allow a download yourself.')}</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className="text-muted-foreground">
                {t(entry.state)} · {Math.ceil(entry.received / 1024)} KiB
              </span>
              {entry.state === 'completed' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void act(() => ramu.invoke('browser.saveDownload', host, taskId, entry.id))}
                >
                  {t('Save')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(() => ramu.invoke('browser.cancelDownload', host, taskId, entry.id))}
              >
                {entry.state === 'progressing' ? t('Cancel') : t('Remove')}
              </Button>
            </div>
          ))}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </div>
  )
}
