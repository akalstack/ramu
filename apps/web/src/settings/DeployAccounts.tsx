import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { accountBrand } from '@ramu/shared/brands'
import { ABILITY_LABELS, MEDIA_ABILITIES } from '@ramu/shared/providers/abilities'
import type { AccountPlatform, HostingAccount, HostingAccountsSummary, HostingSignIn } from '@ramu/shared/types'
import {
  CLI_SIGN_IN_PLATFORMS,
  DEPLOY_ACCOUNT_GROUPS,
  REMOTE_SIGN_IN_PLATFORMS,
  isMediaService,
  type CliSignInPlatform,
} from '@ramu/shared/types/deploy'
import { accountKey } from '@ramu/shared/identities'
import { ExternalLink } from 'lucide-react'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { invoke as openOnThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'
import { AccountIdentityPicker, IdentityDropdown, IdentityName, useAccountIdentities } from './AccountIdentity'

/** What to pick on each platform's token page: the smallest scope it offers. */
const SCOPE_HINT: Record<AccountPlatform, string> = {
  vercel: 'Scope: the team your projects are in, not Full Account',
  netlify: 'Netlify tokens reach every team you belong to, so choose an expiry',
  neon: 'Create a personal API key. Neon keys reach your whole account and do not expire, so revoke it on Neon when Ramu no longer needs it',
  expo: 'Create it for a robot user with the Developer role on the account that owns the app; a personal token reaches every account you belong to',
  gemini:
    'Create an API key in Google AI Studio on a project with billing turned on; video and music need the paid tier',
  elevenlabs: 'Create an API key with access to text to speech, music and sound effects',
}

/** The headline under a platform's name: who is connected and how, or what to do. */
function deployAccountHeadline(account: HostingAccount): string {
  if (!account.connected)
    return account.kind === 'hosting'
      ? t('Not connected. Deploys and Publish to the web need an account.')
      : account.kind === 'store'
        ? t('Not connected. Store releases of phone apps need an account.')
        : account.kind === 'media' && isMediaService(account.platform)
          ? t('Not connected. Abilities can use it for {0}.', {
              0: MEDIA_ABILITIES[account.platform]
                .map((ability) => t(ABILITY_LABELS[ability]).toLowerCase())
                .join(', '),
            })
          : t('Not connected. Databases for your projects need an account.')
  if (account.error) return account.error
  const via = account.via === 'cli' ? t('signed in through its CLI') : t('token saved on this host')
  const who = t('Connected as {0} ({1})', { 0: account.account ?? account.name, 1: via })
  return account.expiresAt
    ? `${who} · ${t('Expires {0}', { 0: new Date(account.expiresAt).toLocaleDateString() })}`
    : who
}

/** Opens Settings → Deploy on the host that needs the account, at that platform's row. */
export const openDeploySettings = (host: string, platform: string) =>
  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'deploy', target: platform, host } }))

/** Deploy platforms grouped by what they do, or one kind (`only`) where another page shows it; the platform's own sign-in first, a guided token page otherwise. */
export function DeployAccounts({ only }: { only?: HostingAccount['kind'] } = {}) {
  const invoke = useSettingsInvoke()
  const [summary, setSummary] = useState<HostingAccountsSummary | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const request = useRef(0)
  const load = useCallback(
    (check: boolean) => {
      const mine = ++request.current
      setFailed(null)
      void Promise.resolve(invoke('deploy.accounts', check)).then(
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
  // Each platform's accounts kept for one identity follow the account for every identity, so they read as one group.
  const ordered = (accounts: HostingAccount[]) =>
    accounts
      .filter((account) => !account.identityId)
      .flatMap((shared) => [
        shared,
        ...accounts.filter((account) => account.identityId && account.platform === shared.platform),
      ])
  const row = (account: HostingAccount) => (
    <DeployAccountRow
      key={`${account.platform}:${account.identityId ?? ''}`}
      account={account}
      ownIdentities={summary!.accounts.flatMap((other) =>
        other.platform === account.platform && other.identityId ? [other.identityId] : [],
      )}
      canAdminister={summary!.canAdminister}
      reload={load}
    />
  )
  return (
    <>
      {only
        ? ordered(summary?.accounts.filter((account) => account.kind === only) ?? []).map(row)
        : DEPLOY_ACCOUNT_GROUPS.map((group) => {
            const accounts = ordered(summary?.accounts.filter((account) => account.kind === group.kind) ?? [])
            return accounts.length ? (
              <section key={group.kind} className="mb-4">
                <SettingsGroupTitle>{t(group.title)}</SettingsGroupTitle>
                {accounts.map(row)}
              </section>
            ) : null
          })}
      {summary && !summary.canAdminister && (
        <p className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {only === 'media'
            ? t(
                'Paste API keys in Ramu on the machine running this host. The key stays in that host’s credential store.',
              )
            : t(
                'Paste tokens on the machine running this host. Vercel, Netlify and Expo can also be signed in from here: their sign-in runs on the host and keeps the token there.',
              )}
        </p>
      )}
    </>
  )
}

/** What the open panel does: connect the account (again), or add one more of the platform for one identity. */
type Panel = 'connect' | 'add'

function DeployAccountRow({
  account,
  ownIdentities,
  canAdminister,
  reload,
}: {
  account: HostingAccount
  /** The identities that already have their own account of this platform. */
  ownIdentities: string[]
  canAdminister: boolean
  reload: (check: boolean) => void
}) {
  const invoke = useSettingsInvoke()
  const [open, setOpen] = useState<Panel | null>(null)
  const { identities, identity, ownerOf } = useAccountIdentities()
  const key = accountKey(account.kind === 'media' ? 'media' : 'hosting', account.platform)
  const own = identity(account.identityId)
  // Identities that could still get their own account of this platform, beside the one for every identity.
  const free = account.identityId ? [] : (identities ?? []).filter((entry) => !ownIdentities.includes(entry.id))
  const [forIdentity, setForIdentity] = useState('')
  const [signIn, setSignIn] = useState<HostingSignIn | null>(null)
  const [token, setToken] = useState('')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenId = useId()
  const waiting = signIn?.state === 'starting' || signIn?.state === 'waiting'
  const signInId = signIn?.id
  const cliPlatform =
    account.cli && (CLI_SIGN_IN_PLATFORMS as readonly string[]).includes(account.platform)
      ? (account.platform as CliSignInPlatform)
      : null
  // From a paired device, a sign-in whose link opens anywhere can still be started; tokens are pasted on the host.
  const remoteSignIn = !canAdminister && !!cliPlatform && REMOTE_SIGN_IN_PLATFORMS.includes(cliPlatform)
  useEffect(() => {
    if (!waiting || !signInId) return
    // The CLI runs on the host; its state is read until the person authorizes or it fails.
    const timer = setInterval(() => {
      void Promise.resolve(invoke('deploy.signInStatus', signInId)).then(
        (next) => {
          setSignIn(next)
          if (next.state === 'connected') {
            setOpen(null)
            reload(false)
          }
        },
        (reason) => setError(errorText(reason)),
      )
    }, 2000)
    return () => clearInterval(timer)
  }, [waiting, signInId, invoke, reload])
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
    if (signInId && waiting) void invoke('deploy.cancelSignIn', signInId)
    setOpen(null)
    setSignIn(null)
    setToken('')
    setError(null)
  }
  const help = account.broadScope
    ? `${deployAccountHeadline(account)} · ${account.broadScope}`
    : deployAccountHeadline(account)
  const openPanel = (panel: Panel) => {
    // A further account is for an identity that has none yet, preferring one the shared account is not put in.
    setForIdentity(panel === 'add' ? ((free.find((entry) => entry.id !== ownerOf(key)) ?? free[0])?.id ?? '') : '')
    setOpen(panel)
  }
  // The CLI sign-in keeps the platform's one shared account, so a further account for an identity uses a token.
  const cliSignIn = !!cliPlatform && open === 'connect' && !account.identityId
  const title =
    open === 'add'
      ? t('Add a {0} account', { 0: account.name })
      : cliSignIn
        ? t('Or use a token')
        : account.kind === 'media'
          ? t('Connect with an API key')
          : t('Connect with a token')
  return (
    <>
      <SettingsRow>
        <SettingsLabel title={account.name} icon={<BrandIcon brand={accountBrand(account.platform)} />} help={help} />
        <span className="flex items-center gap-2">
          {own && <IdentityName identity={own} />}
          {account.connected && !account.identityId && <AccountIdentityPicker accountKey={key} name={account.name} />}
          {account.connected && (
            <Button variant="secondary" size="sm" onClick={() => reload(true)}>
              {t('Check connection')}
            </Button>
          )}
          {(canAdminister || (remoteSignIn && !account.identityId)) && !open && (
            <Button variant="secondary" size="sm" onClick={() => openPanel('connect')}>
              {account.connected ? t('Reconnect') : t('Connect')}
            </Button>
          )}
          {canAdminister && account.connected && free.length > 0 && !open && (
            <Button variant="ghost" size="sm" onClick={() => openPanel('add')}>
              {t('Add account')}
            </Button>
          )}
          {canAdminister && account.connected && !open && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('deploy.disconnect', account.platform, account.identityId)
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
          {/* The CLI sign-in keeps the platform's one shared account, so a further account for an identity uses a token. */}
          {cliSignIn && (
            <section className="flex flex-col gap-2" aria-label={t('Sign in with {0}', { 0: account.name })}>
              <strong>{t('Sign in with {0}', { 0: account.name })}</strong>
              <p className="m-0 text-muted-foreground">
                {t(
                  'Runs {0}’s own sign-in on the host. Authorize Ramu on the page that opens. The token stays in this host’s credential store, and your own CLI login does not change.',
                  { 0: account.name },
                )}
              </p>
              {signIn?.state === 'waiting' && signIn.url && (
                <span className="flex flex-wrap items-center gap-2" role="status">
                  <Button size="sm" onClick={() => void openOnThisComputer('app.openExternal', signIn.url!)}>
                    {t('Open the sign-in page')}
                  </Button>
                  {signIn.code && (
                    <span>
                      {t('Code')} <strong className="font-mono">{signIn.code}</strong>
                    </span>
                  )}
                  <span className="text-muted-foreground">{t('Waiting for you to authorize…')}</span>
                </span>
              )}
              {signIn?.state === 'waiting' && signIn.asksNumber && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(async () => {
                      setSignIn(await invoke('deploy.signInMatch', signIn.id, number.trim()))
                      setNumber('')
                    })
                  }}
                >
                  <label className="flex items-center gap-2">
                    {t('The number the sign-in page shows')}
                    <Input
                      value={number}
                      inputMode="numeric"
                      maxLength={4}
                      className="w-20"
                      onChange={(event) => setNumber(event.target.value.replace(/\D/g, ''))}
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={busy || !number}>
                    {t('Send')}
                  </Button>
                </form>
              )}
              {signIn?.state === 'failed' && signIn.error && (
                <p role="alert" className="m-0 text-destructive">
                  {signIn.error}
                </p>
              )}
              {!waiting && (
                <span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(async () => setSignIn(await invoke('deploy.signIn', cliPlatform)))}
                  >
                    {t('Sign in with {0}', { 0: account.name })}
                  </Button>
                </span>
              )}
            </section>
          )}
          {canAdminister && (
            <form
              className="flex flex-col gap-3"
              aria-label={title}
              onSubmit={(event) => {
                event.preventDefault()
                if (busy || token.trim().length < 8) return
                void run(async () => {
                  const identityId = account.identityId ?? (open === 'add' ? forIdentity : undefined)
                  if (identityId) await invoke('deploy.saveToken', account.platform, token.trim(), identityId)
                  else await invoke('deploy.saveToken', account.platform, token.trim())
                  setToken('')
                  setOpen(null)
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
                  <strong className="text-body">{title}</strong>
                  <p className="m-0 text-caption text-muted-foreground">
                    {`${t(SCOPE_HINT[account.platform])}. ${t('Name it Ramu.')} ${
                      account.kind === 'hosting'
                        ? t('Set an expiry, then copy the token and paste it here.')
                        : t('Copy the key and paste it here.')
                    }`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void openOnThisComputer('app.openExternal', account.tokenPage)}
                >
                  {account.kind === 'media'
                    ? t('Open {0}’s API key page', { 0: account.name })
                    : t('Open {0}’s token page', { 0: account.name })}
                  <ExternalLink data-icon="inline-end" />
                </Button>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={tokenId} className="text-caption">
                  {account.kind === 'media' ? t('API key') : t('API token')}
                </label>
                <Input
                  id={tokenId}
                  className="w-full! flex-auto!"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={!cliSignIn}
                  placeholder={account.kind === 'media' ? t('Paste the key') : t('Paste the token')}
                  disabled={busy}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="m-0 text-caption text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="m-0 min-w-0 flex-1 basis-64 text-caption text-muted-foreground">
                  {account.kind === 'media'
                    ? t(
                        'The key goes straight to the host’s credential store, is checked with {0}, and is never shown again.',
                        { 0: account.name },
                      )
                    : t(
                        'The token goes straight to the host’s credential store, is checked with {0}, and is never shown again.',
                        { 0: account.name },
                      )}
                </p>
                <span className="flex flex-wrap items-center gap-2">
                  {open === 'add' && identities && (
                    <IdentityDropdown
                      identities={free}
                      everyIdentity={false}
                      caption={t('For')}
                      label={t('Projects of this identity use it; every other project keeps using {0}.', {
                        0: account.account ?? account.name,
                      })}
                      value={forIdentity}
                      onChange={setForIdentity}
                    />
                  )}
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={close}>
                    {t('Cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={busy || token.trim().length < 8}>
                    {busy
                      ? t('Checking…')
                      : open === 'add'
                        ? t('Add account')
                        : account.connected
                          ? t('Save')
                          : t('Connect')}
                  </Button>
                </span>
              </div>
            </form>
          )}
          {/* Without the token form (a paired device), the panel still shows what failed and can be closed. */}
          {!canAdminister && (
            <>
              {error && (
                <p role="alert" className="m-0 text-caption text-destructive">
                  {error}
                </p>
              )}
              <span>
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  {t('Cancel')}
                </Button>
              </span>
            </>
          )}
        </SettingsRow>
      )}
    </>
  )
}
