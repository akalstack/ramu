import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ForgeConnectionSummary, ForgeSavedConnection } from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'
import { accountDetail, connectionHeadline, savedDetail } from './hostingStatus'

/** Providers shown for orientation only: no setup, no network calls, no background work until they are built. */
const COMING_SOON = ['GitLab', 'Bitbucket Cloud', 'Azure DevOps'] as const

type Form = { replace: ForgeSavedConnection | null }

/**
 * A credential is written only by an explicit Save connection, never on blur, and never held after the form closes.
 * The token goes to the host as a write-only request; nothing here stores or echoes it.
 */
function ConnectionForm({
  replace,
  busy,
  error,
  onSave,
  onCancel,
}: {
  replace: ForgeSavedConnection | null
  busy: boolean
  error: string | null
  onSave: (origin: string, token: string) => void
  onCancel: () => void
}) {
  const [enterprise, setEnterprise] = useState(!!replace && replace.origin !== 'github.com')
  const [server, setServer] = useState(replace && replace.origin !== 'github.com' ? replace.origin : '')
  const [token, setToken] = useState('')
  const tokenId = useId()
  const serverId = useId()
  const origin = replace ? replace.origin : enterprise ? server.trim() : 'github.com'
  return (
    <form
      className="mb-3 flex flex-col gap-2 rounded-(--radius-m) bg-fill p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (origin && token.trim()) onSave(origin, token.trim())
      }}
    >
      <strong>{replace ? t('Replace credential') : t('Connect GitHub')}</strong>
      {!replace && (
        <label className="flex items-center gap-2 text-caption">
          <Checkbox checked={enterprise} onCheckedChange={(checked) => setEnterprise(checked === true)} />
          {t('GitHub Enterprise server')}
        </label>
      )}
      {(enterprise || replace) && (
        <label htmlFor={serverId} className="flex flex-col gap-1 text-caption">
          {t('Server')}
          <Input
            id={serverId}
            value={origin}
            disabled={!!replace || busy}
            placeholder="ghe.example.com"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setServer(event.target.value)}
          />
        </label>
      )}
      <label htmlFor={tokenId} className="flex flex-col gap-1 text-caption">
        {t('Personal access token')}
        <Input
          id={tokenId}
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          disabled={busy}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Prefer a fine-grained token limited to the repositories you need. The token is stored by the host in its OS credential store, is sent only to {0}, and is never shown again.',
          { '0': origin || t('this server') },
        )}
      </p>
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'A saved token covers pull requests, issues and checks. Git push and fetch keep using your own Git credentials.',
        )}
      </p>
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
      <span className="flex gap-2">
        <Button type="submit" variant="default" size="sm" disabled={busy || !origin || !token.trim()}>
          {busy ? t('Checking…') : t('Save connection')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </span>
    </form>
  )
}

/** GitHub from the sign-ins the host's `gh` holds and the tokens saved on that host; other providers are not built yet. */
export function HostingAccounts() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const [summary, setSummary] = useState<ForgeConnectionSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ForgeSavedConnection | null>(null)
  const request = useRef(0)
  const opener = useRef<HTMLButtonElement>(null)
  const check = useCallback(() => {
    const mine = ++request.current
    setBusy(true)
    setFailed(false)
    invoke('forge.connections').then(
      (next) => {
        if (mine !== request.current) return
        setSummary(next)
        setBusy(false)
      },
      () => {
        if (mine !== request.current) return
        // An older host has no such method: say nothing is known rather than that nothing is connected.
        setFailed(true)
        setBusy(false)
      },
    )
  }, [invoke])
  useEffect(() => {
    // A different host has different accounts: forget the previous host's list, any open form and its token.
    setSummary(null)
    setForm(null)
    setRemoving(null)
    setActionError(null)
    check()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++request.current
    }
  }, [check])

  const saved = summary?.saved ?? []
  const canAdminister = summary?.canAdminister !== false
  const storeLocked = summary?.credentialStore === 'unavailable'

  const act = async (work: () => Promise<unknown>) => {
    setActionError(null)
    setPending(true)
    try {
      await work()
    } catch (reason) {
      setActionError(errorText(reason))
    } finally {
      setPending(false)
      check()
    }
  }
  const closeForm = () => {
    setForm(null)
    setFormError(null)
    // Focus returns to where the form was opened from.
    opener.current?.focus()
  }
  const save = async (origin: string, token: string) => {
    setPending(true)
    setFormError(null)
    try {
      await invoke('forge.saveConnection', { origin, token, ...(form?.replace ? { replaceId: form.replace.id } : {}) })
      closeForm()
      check()
    } catch (reason) {
      // A failed check keeps the previous connection; the form stays open so the token can be corrected.
      setFormError(errorText(reason))
    } finally {
      setPending(false)
    }
  }
  const origins = [...new Set(saved.map((connection) => connection.origin))]
  const hasCli = (summary?.accounts.length ?? 0) > 0

  return (
    <>
      <SettingsGroupTitle>{t('Hosting accounts')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel title="GitHub" help={connectionHeadline(summary, failed)} />
        <span className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-busy={busy} onClick={check}>
            {busy ? t('Checking…') : t('Check connection')}
          </Button>
          {canAdminister && !form && (
            <Button
              ref={opener}
              variant="secondary"
              size="sm"
              disabled={storeLocked || pending || !summary}
              onClick={() => {
                setOpen(true)
                setForm({ replace: null })
              }}
            >
              {t('Connect')}
            </Button>
          )}
          {summary && (summary.accounts.length > 0 || saved.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-controls="github-accounts"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? t('Hide details') : t('Details')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {storeLocked && (
        <p role="status" className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {t(
            'The credential store on this host is locked or unavailable, so tokens cannot be saved. Unlock it on that machine and check again. Existing GitHub CLI sign-ins keep working.',
          )}
        </p>
      )}
      {!canAdminister && (
        <p className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {t('Add, replace or remove GitHub tokens on the machine running this host.')}
        </p>
      )}
      {actionError && (
        <p role="alert" className="m-0 mb-3 px-4 text-caption text-destructive">
          {actionError}
        </p>
      )}
      {form && (
        <ConnectionForm
          key={form.replace?.id ?? 'new'}
          replace={form.replace}
          busy={pending}
          error={formError}
          onSave={(origin, token) => void save(origin, token)}
          onCancel={closeForm}
        />
      )}
      {open && summary && (
        <div id="github-accounts" className="mb-3 flex flex-col gap-3 px-4 text-caption">
          {saved.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('Saved tokens')}>
              {saved.map((connection) => (
                <li key={connection.id} className="flex flex-col gap-1">
                  <span>
                    <strong>{connection.login ?? t('Unknown account')}</strong>{' '}
                    <span className="text-muted-foreground">{connection.origin}</span>
                  </span>
                  <span className="text-muted-foreground">{savedDetail(connection)}</span>
                  {canAdminister && (
                    <span className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void act(() => invoke('forge.checkConnection', connection.id))}
                      >
                        {t('Check connection')}
                      </Button>
                      {!connection.selected && connection.enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            void act(() => invoke('forge.selectAccount', connection.origin, connection.id))
                          }
                        >
                          {t('Use by default')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending || storeLocked}
                        onClick={() => {
                          setForm({ replace: connection })
                          setFormError(null)
                        }}
                      >
                        {t('Replace credential')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void act(() => invoke('forge.setConnectionEnabled', connection.id, !connection.enabled))
                        }
                      >
                        {connection.enabled ? t('Disable') : t('Enable')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRemoving(connection)}>
                        {t('Disconnect')}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hasCli && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('GitHub CLI sign-ins')}>
              {summary.accounts.map((account) => (
                <li key={`${account.host}:${account.login}`}>
                  <strong>{account.login}</strong> <span className="text-muted-foreground">{account.host}</span>
                  <div className="text-muted-foreground">{accountDetail(account)}</div>
                  {canAdminister &&
                    account.state === 'ok' &&
                    summary.accounts.filter((other) => other.host === account.host).length > 1 &&
                    summary.selection?.[account.host] !== `cli:${account.login}` && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void act(() => invoke('forge.selectAccount', account.host, `cli:${account.login}`))
                        }
                      >
                        {t('Use {0} for {1}', { '0': account.login, '1': account.host })}
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          )}
          {canAdminister &&
            hasCli &&
            origins
              .filter((origin) => summary.selection?.[origin] !== 'cli')
              .map((origin) => (
                <span key={origin}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void act(() => invoke('forge.selectAccount', origin, 'cli'))}
                  >
                    {t('Use the GitHub CLI for {0}', { '0': origin })}
                  </Button>
                </span>
              ))}
        </div>
      )}
      {removing && (
        <Dialog
          title={t('Disconnect {0}?', { '0': removing.login ?? removing.origin })}
          confirmLabel={t('Disconnect')}
          danger
          busy={pending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const target = removing
            setRemoving(null)
            void act(() => invoke('forge.removeConnection', target.id))
          }}
        >
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'Ramu deletes its saved token and stops pull request watches that used it. It does not sign out the GitHub CLI or change Git settings. To revoke the token itself, delete it in GitHub under Settings, Developer settings.',
            )}
          </p>
        </Dialog>
      )}
      {COMING_SOON.map((name) => (
        <SettingsRow key={name}>
          <SettingsLabel title={name} />
          <span className="text-caption text-muted-foreground">{t('Coming soon')}</span>
        </SettingsRow>
      ))}
    </>
  )
}
