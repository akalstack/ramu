import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { ABILITY_LABELS, MEDIA_ABILITIES } from '@ramu/shared/providers/abilities'
import { accountKey } from '@ramu/shared/identities'
import type { MediaAccount, MediaAccountsSummary, MediaService } from '@ramu/shared/types/media'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { invoke as openOnThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'
import { AccountIdentityPicker } from './AccountIdentity'

/** What to pick on each service's key page. */
const KEY_HINT: Record<MediaService, string> = {
  gemini:
    'Create an API key in Google AI Studio on a project with billing turned on; video and music need the paid tier',
  elevenlabs: 'Create an API key with access to text to speech, music and sound effects',
}

function headline(account: MediaAccount): string {
  if (!account.connected)
    return t('Not connected. Abilities can use it for {0}.', {
      0: MEDIA_ABILITIES[account.service].map((ability) => t(ABILITY_LABELS[ability]).toLowerCase()).join(', '),
    })
  if (account.error) return account.error
  // A provider's key stays that provider's: removing it there stops this too.
  if (account.sharedFrom) return t('Uses your {0} key. Remove the key from {0} to stop.', { 0: account.sharedFrom })
  return t('Connected as {0} ({1})', { 0: account.account ?? account.name, 1: t('key saved on this host') })
}

/** Each media service's API key on the chosen host: pasted on the host itself, checked, then never shown again. */
export function MediaKeys() {
  const invoke = useSettingsInvoke()
  const [summary, setSummary] = useState<MediaAccountsSummary | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const request = useRef(0)
  const load = useCallback(
    (check: boolean) => {
      const mine = ++request.current
      setFailed(null)
      void Promise.resolve(invoke('abilities.mediaAccounts', check)).then(
        (next) => {
          if (mine === request.current) setSummary(next)
        },
        (reason) => {
          if (mine === request.current) setFailed(errorText(reason))
        },
      )
    },
    [invoke],
  )
  useEffect(() => {
    setSummary(null)
    load(false)
  }, [load])
  if (failed)
    return (
      <p role="alert" className="m-0 mb-3 px-4 text-caption text-destructive">
        {failed}
      </p>
    )
  return (
    <>
      {summary?.accounts.map((account) => (
        <MediaKeyRow key={account.service} account={account} canAdminister={summary.canAdminister} reload={load} />
      ))}
      {summary && !summary.canAdminister && (
        <p className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {t('Paste API keys in Ramu on the machine running this host. The key stays in that host’s credential store.')}
        </p>
      )}
    </>
  )
}

function MediaKeyRow({
  account,
  canAdminister,
  reload,
}: {
  account: MediaAccount
  canAdminister: boolean
  reload: (check: boolean) => void
}) {
  const invoke = useSettingsInvoke()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyId = useId()
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setOpen(false)
    setKey('')
    setError(null)
  }
  return (
    <>
      <SettingsRow>
        <SettingsLabel title={account.name} icon={<BrandIcon brand={account.service} />} help={headline(account)} />
        <span className="flex items-center gap-2">
          {account.connected && (
            <AccountIdentityPicker accountKey={accountKey('media', account.service)} name={account.name} />
          )}
          {account.connected && (
            <Button variant="secondary" size="sm" onClick={() => reload(true)}>
              {t('Check connection')}
            </Button>
          )}
          {canAdminister && !open && (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {account.sharedFrom ? t('Use another key') : account.connected ? t('Reconnect') : t('Connect')}
            </Button>
          )}
          {canAdminister && account.connected && !account.sharedFrom && !open && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('abilities.removeMediaKey', account.service)
                  reload(false)
                })
              }
            >
              {t('Disconnect')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {error && !open && (
        <p role="alert" className="m-0 mb-3 px-4 text-caption text-destructive">
          {error}
        </p>
      )}
      {open && (
        <SettingsRow className="settings-stack gap-3!">
          <form
            className="flex flex-col gap-3"
            aria-label={t('Connect with an API key')}
            onSubmit={(event) => {
              event.preventDefault()
              if (busy || key.trim().length < 8) return
              void run(async () => {
                await invoke('abilities.saveMediaKey', account.service, key.trim())
                close()
                reload(false)
              })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.stopPropagation()
                close()
              }
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <strong className="text-body">{t('Connect with an API key')}</strong>
                <p className="m-0 text-caption text-muted-foreground">
                  {`${t(KEY_HINT[account.service])}. ${t('Name it Ramu.')} ${t('Copy the key and paste it here.')}`}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void openOnThisComputer('app.openExternal', account.tokenPage)}
              >
                {t('Open {0}’s API key page', { 0: account.name })}
                <ExternalLink data-icon="inline-end" />
              </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={keyId} className="text-caption">
                {t('API key')}
              </label>
              <Input
                id={keyId}
                className="w-full! flex-auto!"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                placeholder={t('Paste the key')}
                disabled={busy}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="m-0 text-caption text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="m-0 min-w-0 flex-1 basis-64 text-caption text-muted-foreground">
                {t(
                  'The key goes straight to the host’s credential store, is checked with {0}, and is never shown again.',
                  { 0: account.name },
                )}
              </p>
              <span className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={close}>
                  {t('Cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={busy || key.trim().length < 8}>
                  {busy ? t('Checking…') : account.connected ? t('Save') : t('Connect')}
                </Button>
              </span>
            </div>
          </form>
        </SettingsRow>
      )}
    </>
  )
}
