import { useEffect, useState, type ReactNode } from 'react'
import type { BrowserImportSource, BrowserProfileInfo } from '@ramu/shared/types/browser'
import { Button } from '@/components/desktop-button'
import { invokeOn, ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { BrowserImportWizard } from './BrowserImportWizard'

/**
 * The entry to copying sign-ins from the person's real browser: lists the browsers found on this computer, then opens
 * the wizard for the one chosen. `scope` picks where the copy lands: the desktop's own browser or this host's Chromium.
 */
export function BrowserImportPanel({
  hostId,
  scope,
  existing,
  busy = false,
  onChanged,
  alternative,
}: {
  hostId: string
  scope: 'desktop' | 'host'
  existing: readonly BrowserProfileInfo[]
  busy?: boolean
  onChanged(): void
  /** Another way to get signed in, offered beside the browsers. */
  alternative?: ReactNode
}) {
  useLanguage()
  const [sources, setSources] = useState<BrowserImportSource[] | null>(null)
  const [importing, setImporting] = useState<BrowserImportSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setSources(null)
    setImporting(null)
    setError('')
  }, [hostId, scope])
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setSources(
        scope === 'host'
          ? await invokeOn(hostId, 'hostBrowser.importSources')
          : await ramu.invoke('browser.profiles.importSources', hostId),
      )
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load()}>
        {t('Import signed-in sessions')}
      </Button>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {sources && (
        <div className="space-y-2 text-caption">
          <p className="text-muted-foreground">
            {t(
              'Import copies sign-in cookies once into a new profile. Nothing is read until you choose a browser, and the source browser is never changed.',
            )}
          </p>
          {sources.map((source) => (
            <div key={source.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {source.name} · {t(source.installed ? 'Installed' : 'Not installed')}
                {!source.supported && ` · ${t(source.reason ?? 'Unavailable')}`}
              </span>
              {source.supported && source.installed && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setImporting(source)}
                >
                  {t('Import…')}
                </Button>
              )}
            </div>
          ))}
          {alternative}
        </div>
      )}
      {importing && (
        <BrowserImportWizard
          hostId={hostId}
          scope={scope}
          source={importing}
          existing={existing}
          onClose={() => setImporting(null)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}
