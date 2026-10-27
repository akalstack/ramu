import { useEffect, useState } from 'react'
import type {
  BrowserImportDomain,
  BrowserImportProfile,
  BrowserImportSource,
  BrowserImportStaged,
  BrowserProfileInfo,
} from '@ramu/shared/types/browser'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import {
  IMPORT_CAVEAT,
  canImport,
  defaultImportName,
  resultLines,
  selectedCookieCount,
  toggleDomain,
} from './browserImportModel'

type Step = 'profile' | 'reading' | 'sites' | 'review' | 'importing' | 'result'

/**
 * Copies sign-ins once from another browser into a new profile. Every step names what it does and reads nothing more:
 * profile names first, then site names with counts (the macOS keychain asks here for Chrome and Edge), then the copy.
 * The new profile stays hidden from agents until the person keeps it.
 */
export function BrowserImportWizard({
  hostId,
  source,
  existing,
  onClose,
  onChanged,
}: {
  hostId: string
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
  const [name, setName] = useState('')
  const [staged, setStaged] = useState<BrowserImportStaged | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ramu.invoke('browser.import.profiles', hostId, source.id).then(
      (list) => active && setProfiles(list),
      (reason) => active && setError(t(errorText(reason))),
    )
    return () => {
      active = false
    }
  }, [hostId, source.id])

  // Closing at any point gives up what was read, and removes a copy that was not kept.
  const finish = async (discardStaged: boolean) => {
    try {
      if (token && step !== 'result') await ramu.invoke('browser.import.cancel', hostId, token)
      if (discardStaged && staged) await ramu.invoke('browser.import.discard', hostId, staged.profileId)
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
      const read = await ramu.invoke('browser.import.inspect', hostId, source.id, entry.id)
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
      setStaged(await ramu.invoke('browser.import.run', hostId, token, [...selected], name.trim()))
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
      await ramu.invoke('browser.import.keep', hostId, staged.profileId)
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
            {!profiles ? (
              <span className="text-caption">{t('Looking for profiles…')}</span>
            ) : profiles.length ? (
              profiles.map((entry) => (
                <Button key={entry.id} variant="secondary" onClick={() => void choose(entry)}>
                  {entry.name}
                </Button>
              ))
            ) : (
              <span className="text-caption">
                {t('No profiles were found. Close {0} and try again, or sign in manually.', { 0: source.name })}
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
              {t('Choose the websites to copy. None are selected yet.')}
            </span>
            <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
              {domains.map((entry) => (
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
