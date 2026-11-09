import { useEffect, useState, type ReactNode } from 'react'
import type { BrowserImportSource, BrowserProfileInfo } from '@ramu/shared/types/browser'
import { Globe } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
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
  const installed = sources?.filter((source) => source.installed) ?? []
  const missing = sources?.filter((source) => !source.installed) ?? []
  return (
    <>
      {/* One card: what import does and its one action, then a row per browser found, so the choice reads at a glance. */}
      <SettingsRow>
        <SettingsLabel
          title={t('Import signed-in sessions')}
          help={t(
            'Copy sign-ins from a browser on this computer into a new profile, once. Nothing is read until you choose, and that browser is never changed.',
          )}
        />
        {!sources && (
          <Button type="button" variant="secondary" size="sm" disabled={busy || loading} onClick={() => void load()}>
            {loading ? t('Looking…') : t('Choose a browser')}
          </Button>
        )}
      </SettingsRow>
      {installed.map((source) => (
        <SettingsRow key={source.id}>
          <span className="flex min-w-0 items-center gap-2.5">
            <Globe size={15} className="flex-none text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-control">{source.name}</span>
              {!source.supported && (
                <span className="block truncate text-caption text-muted-foreground" title={source.reason}>
                  {source.reason?.includes('Full Disk Access')
                    ? t('Needs Full Disk Access to read its sign-ins')
                    : t(source.reason ?? 'Unavailable')}
                </span>
              )}
            </span>
          </span>
          {source.supported ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setImporting(source)}>
              {t('Import…')}
            </Button>
          ) : (
            alternative
          )}
        </SettingsRow>
      ))}
      {sources && !installed.length && (
        <SettingsRow>
          <SettingsLabel title={t('No browser found')} help={t('Sign in to the websites in a Ramu profile instead.')} />
          {alternative}
        </SettingsRow>
      )}
      {missing.length > 0 && (
        <p className="m-0 -mt-2 mb-3 px-4 text-caption text-muted-foreground">
          {t('Not found on this computer: {0}', { 0: missing.map((source) => source.name).join(', ') })}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 mb-3 px-4 text-caption text-bad">
          {error}
        </p>
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
