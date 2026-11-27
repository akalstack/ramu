import { useEffect, useMemo, useState } from 'react'
import { BROWSER_DATA_BLOCKED } from '@ramu/shared/types/browser'
import { MacPermission } from './MacPermission'
import type {
  BrowserImportDomain,
  BrowserImportProfile,
  BrowserImportSource,
  BrowserImportStaged,
  BrowserProfileInfo,
} from '@ramu/shared/types/browser'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { SearchField } from '@/components/search-field'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { invokeOn, ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import {
  IMPORT_CAVEAT,
  canImport,
  defaultImportName,
  resultLines,
  selectedCookieCount,
  toggleDomain,
  matchingDomains,
  toggleAll,
} from './browserImportModel'

/** Where the copy lands: the desktop's own browser, or the Chromium this host runs. */
function importApi(scope: 'desktop' | 'host', hostId: string) {
  return scope === 'host'
    ? {
        profiles: (source: string) => invokeOn(hostId, 'hostBrowser.importProfiles', source),
        inspect: (source: string, profile: string) => invokeOn(hostId, 'hostBrowser.importInspect', source, profile),
        run: (token: string, domains: string[], name: string) =>
          invokeOn(hostId, 'hostBrowser.importRun', token, domains, name),
        cancel: (token: string) => invokeOn(hostId, 'hostBrowser.importCancel', token),
        keep: (profile: string) => invokeOn(hostId, 'hostBrowser.importKeep', profile),
        discard: (profile: string) => invokeOn(hostId, 'hostBrowser.importDiscard', profile),
      }
    : {
        profiles: (source: string) => ramu.invoke('browser.import.profiles', hostId, source),
        inspect: (source: string, profile: string) => ramu.invoke('browser.import.inspect', hostId, source, profile),
        run: (token: string, domains: string[], name: string) =>
          ramu.invoke('browser.import.run', hostId, token, domains, name),
        cancel: (token: string) => ramu.invoke('browser.import.cancel', hostId, token),
        keep: (profile: string) => ramu.invoke('browser.import.keep', hostId, profile),
        discard: (profile: string) => ramu.invoke('browser.import.discard', hostId, profile),
      }
}

type Step = 'profile' | 'reading' | 'sites' | 'review' | 'importing' | 'result'

/**
 * Copies sign-ins once from another browser into a new profile. Every step names what it does and reads nothing more:
 * profile names first, then site names with counts (the macOS keychain asks here for Chrome and Edge), then the copy.
 * The new profile stays hidden from agents until the person keeps it.
 */
export function BrowserImportWizard({
  hostId,
  scope = 'desktop',
  source,
  existing,
  onClose,
  onChanged,
}: {
  hostId: string
  scope?: 'desktop' | 'host'
  source: BrowserImportSource
  existing: readonly BrowserProfileInfo[]
  onClose(): void
  onChanged(): void
}) {
  useLanguage()
  const [step, setStep] = useState<Step>('profile')
  const [profiles, setProfiles] = useState<BrowserImportProfile[] | null>(null)
  const [token, setToken] = useState('')
  const [domains, setDomains] = useState<BrowserImportDomain[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Long cookie lists are searched by address; Select all acts on what the search shows.
  const [search, setSearch] = useState('')
  const shown = useMemo(() => matchingDomains(domains, search), [domains, search])
  const [name, setName] = useState('')
  const [staged, setStaged] = useState<BrowserImportStaged | null>(null)
  const [error, setError] = useState('')
  const api = useMemo(() => importApi(scope, hostId), [scope, hostId])

  // The system refused to let Ramu read the browser: offer the setting that allows it, then look again.
  const [blocked, setBlocked] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setBlocked(false)
    setProfiles(null)
    api.profiles(source.id).then(
      (list) => active && setProfiles(list),
      (reason) => {
        if (!active) return
        if (errorText(reason) === BROWSER_DATA_BLOCKED) setBlocked(true)
        else setError(t(errorText(reason)))
      },
    )
    return () => {
      active = false
    }
  }, [api, source.id, attempt])

  // Closing at any point gives up what was read, and removes a copy that was not kept.
  const finish = async (discardStaged: boolean) => {
    try {
      if (token && step !== 'result') await api.cancel(token)
      if (discardStaged && staged) await api.discard(staged.profileId)
    } catch {
      /* Nothing left to give up. */
    }
    onChanged()
    onClose()
  }

  const choose = async (entry: BrowserImportProfile) => {
    setError('')
    setStep('reading')
    try {
      const read = await api.inspect(source.id, entry.id)
      setToken(read.token)
      setDomains(read.domains)
      setName(defaultImportName(source.name, entry.name, existing))
      setSelected(new Set())
      setStep('sites')
    } catch (reason) {
      setError(t(errorText(reason)))
      setStep('profile')
    }
  }

  const run = async () => {
    setStep('importing')
    setError('')
    try {
      setStaged(await api.run(token, [...selected], name.trim()))
      setToken('')
      setStep('result')
    } catch (reason) {
      setError(t(errorText(reason)))
      setStep('review')
    }
  }

  const keep = async () => {
    if (!staged) return
    try {
      await api.keep(staged.profileId)
      onChanged()
      onClose()
    } catch (reason) {
      setError(t(errorText(reason)))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && step !== 'importing' && void finish(step === 'result')}>
      <DialogContent className="max-h-[calc(100vh-48px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Import signed-in sessions from {0}', { 0: source.name })}</DialogTitle>
          <DialogDescription>
            {t(
              'Copies sign-in cookies once into a new Ramu profile on this computer. Passwords, history and extensions are not copied, and {0} is never changed.',
              { 0: source.name },
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        {step === 'profile' && (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-muted-foreground">{t('Choose the browser profile to copy from.')}</span>
            {blocked ? (
              <MacPermission
                pane="full-disk-access"
                reason={t('macOS blocked Ramu from reading {0}’s data.', { 0: source.name })}
                onCheckAgain={() => setAttempt((count) => count + 1)}
              />
            ) : !profiles ? (
              <span className="text-caption">{t('Looking for profiles…')}</span>
            ) : profiles.length ? (
              profiles.map((entry) => (
                <Button key={entry.id} variant="secondary" onClick={() => void choose(entry)}>
                  {entry.name}
                </Button>
              ))
            ) : (
              <span className="text-caption">
                {t('No {0} profiles were found on this computer. Sign in to a Ramu profile instead.', {
                  0: source.name,
                })}
              </span>
            )}
          </div>
        )}
        {step === 'reading' && (
          <span role="status" className="text-caption">
            {t('Reading website names… macOS may ask you to allow keychain access.')}
          </span>
        )}
        {step === 'sites' && (
          <div className="flex flex-col gap-2">
            <span className="text-caption text-muted-foreground">
              {selected.size
                ? t('{0} of {1} websites selected', { 0: selected.size, 1: domains.length })
                : t('Choose the websites to copy. None are selected yet.')}
            </span>
            {domains.length > 0 && (
              <div className="flex items-center gap-2">
                <SearchField className="flex-1" value={search} onChange={setSearch} label={t('Search websites')} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!shown.length}
                  onClick={() => setSelected((current) => toggleAll(current, shown))}
                >
                  {shown.length && shown.every((entry) => selected.has(entry.domain))
                    ? t('Clear')
                    : search.trim()
                      ? t('Select shown')
                      : t('Select all')}
                </Button>
              </div>
            )}
            <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
              {shown.map((entry) => (
                <li key={entry.domain}>
                  <label className="flex cursor-pointer items-center gap-2 text-control">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.domain)}
                      onChange={() => setSelected((current) => toggleDomain(current, entry.domain))}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.domain}</span>
                    <span className="text-caption text-muted-foreground tabular-nums">{entry.cookies}</span>
                  </label>
                </li>
              ))}
              {!domains.length && <li className="text-caption">{t('This profile has no sign-in cookies to copy.')}</li>}
              {domains.length > 0 && !shown.length && (
                <li className="text-caption text-muted-foreground">
                  {t('No website matches “{0}”.', { 0: search.trim() })}
                </li>
              )}
            </ul>
            <Input
              aria-label={t('New profile name')}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void finish(false)}>
                {t('Cancel')}
              </Button>
              <Button disabled={!canImport(selected, name)} onClick={() => setStep('review')}>
                {t('Review')}
              </Button>
            </div>
          </div>
        )}
        {step === 'review' && (
          <div className="flex flex-col gap-2 text-control">
            <p className="m-0">
              {t('Copy {0} cookies from {1} websites into a new profile named {2} on this computer?', {
                0: selectedCookieCount(domains, selected),
                1: selected.size,
                2: name.trim(),
              })}
            </p>
            <p className="m-0 text-caption text-muted-foreground">
              {t(
                'Agents you give this profile to can use these website sessions. Nothing is shared with other computers.',
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep('sites')}>
                {t('Back')}
              </Button>
              <Button onClick={() => void run()}>{t('Import sessions')}</Button>
            </div>
          </div>
        )}
        {step === 'importing' && (
          <span role="status" className="text-caption">
            {t('Copying…')}
          </span>
        )}
        {step === 'result' && staged && (
          <div className="flex flex-col gap-2 text-control">
            {resultLines(staged.result).map((line) => (
              <p key={line} className="m-0">
                {t(line)}
              </p>
            ))}
            <p className="m-0 text-caption text-muted-foreground">{t(IMPORT_CAVEAT)}</p>
            <p className="m-0 text-caption">{t('The new profile stays hidden from agents until you keep it.')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void finish(true)}>
                {t('Discard')}
              </Button>
              <Button onClick={() => void keep()}>{t('Keep profile')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
