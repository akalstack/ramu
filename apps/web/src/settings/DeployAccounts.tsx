import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { accountBrand } from '@ramu/shared/brands'
import { accountName } from '@ramu/shared/deployText'
import type { AccountPlatform, HostingAccount, HostingAccountsSummary, HostingSignIn } from '@ramu/shared/types'
import { CLI_SIGN_IN_PLATFORMS, REMOTE_SIGN_IN_PLATFORMS, type CliSignInPlatform } from '@ramu/shared/types/deploy'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { invoke as openOnThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { ServerConnect } from './ServerConnect'
import { useSettingsInvoke } from './SettingsScope'

/** What to pick on each platform's token page: the smallest scope it offers. */
const SCOPE_HINT: Record<Exclude<AccountPlatform, 'server' | 'github-pages' | 'cloudflare-workers'>, string> = {
  vercel: 'Scope: the team your projects are in, not Full Account',
  netlify: 'Netlify tokens reach every team you belong to, so choose an expiry',
  railway: 'Pick the workspace your projects are in, so the token reaches only that workspace',
  cloudflare:
    'Create a custom token with only Account → Cloudflare Pages → Edit, for the one account your sites go in; it is kept in each linked repository’s Actions secrets',
  fly: 'Create an organization token for the organization your apps go in, rather than a personal access token',
  neon: 'Create a personal API key. Neon keys reach your whole account and do not expire, so revoke it on Neon when Ramu no longer needs it',
  supabase:
    'Create an access token with an expiry. Supabase tokens reach every organization you belong to, and Ramu creates projects in the first one',
  upstash:
    'Create a Developer API key, then paste your account email and the key joined by a colon (you@example.com:key). The key reaches every database of the account',
  resend:
    'Create a key with Full access, which creating sending keys needs; the app gets sending-only keys, never this one',
  expo: 'Create it for a robot user with the Developer role on the account that owns the app; a personal token reaches every account you belong to',
}

/** The headline under a platform's name: who is connected and how, or what to do. */
function deployAccountHeadline(account: HostingAccount): string {
  if (!account.connected)
    return account.kind === 'hosting'
      ? t('Not connected. Deploys and Publish to the web need an account.')
      : account.kind === 'store'
        ? t('Not connected. Store releases of phone apps need an account.')
        : t('Not connected. Databases for your projects need an account.')
  if (account.error) return account.error
  if (account.platform === 'server')
    return t('Connected as {0} with an SSH key kept on this host', { 0: account.account ?? account.name })
  const via = account.via === 'cli' ? t('signed in through its CLI') : t('token saved on this host')
  const who = t('Connected as {0} ({1})', { 0: account.account ?? account.name, 1: via })
  return account.expiresAt
    ? `${who} · ${t('Expires {0}', { 0: new Date(account.expiresAt).toLocaleDateString() })}`
    : who
}

/** Hosting platforms and database providers: the platform's own sign-in first, a guided token page otherwise. */
export function DeployAccounts() {
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
  return (
    <>
      {/* GitHub Pages uses the repository's GitHub sign-in, listed under GitHub; there is nothing to connect. */}
      {summary?.accounts
        .filter((account) => account.platform !== 'github-pages' && account.platform !== 'cloudflare-workers')
        .map((account) => (
          <DeployAccountRow
            key={account.platform}
            account={account}
            canAdminister={summary.canAdminister}
            reload={load}
          />
        ))}
      {summary && !summary.canAdminister && (
        <p className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {t(
            'Paste tokens on the machine running this host. Vercel, Netlify and Railway can also be signed in from here: their sign-in runs on the host and keeps the token there.',
          )}
        </p>
      )}
    </>
  )
}

function DeployAccountRow({
  account,
  canAdminister,
  reload,
}: {
  account: HostingAccount
  canAdminister: boolean
  reload: (check: boolean) => void
}) {
  const invoke = useSettingsInvoke()
  const [open, setOpen] = useState(false)
  const [signIn, setSignIn] = useState<HostingSignIn | null>(null)
  const [token, setToken] = useState('')
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
            setOpen(false)
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
    setOpen(false)
    setSignIn(null)
    setToken('')
    setError(null)
  }
  const help = account.broadScope
    ? `${deployAccountHeadline(account)} · ${account.broadScope}`
    : deployAccountHeadline(account)
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={accountName(t, account.platform, account.name)}
          icon={<BrandIcon brand={accountBrand(account.platform)} />}
          help={help}
        />
        <span className="flex items-center gap-2">
          {account.connected && (
            <Button variant="secondary" size="sm" onClick={() => reload(true)}>
              {t('Check connection')}
            </Button>
          )}
          {(canAdminister || remoteSignIn) && !open && !(account.platform === 'server' && account.connected) && (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              {account.connected ? t('Reconnect') : t('Connect')}
            </Button>
          )}
          {canAdminister && account.connected && !open && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('deploy.disconnect', account.platform)
                  reload(false)
                })
              }
            >
              {t('Disconnect')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {open && account.platform === 'server' && (
        <div className="mb-3 flex flex-col gap-3 rounded-(--radius-m) bg-fill p-4 text-caption">
          <ServerConnect
            invoke={invoke}
            canAdminister={canAdminister}
            onConnected={() => {
              setOpen(false)
              reload(false)
            }}
          />
          <span>
            <Button variant="ghost" size="sm" onClick={close}>
              {t('Cancel')}
            </Button>
          </span>
        </div>
      )}
      {open &&
        account.platform !== 'server' &&
        account.platform !== 'github-pages' &&
        account.platform !== 'cloudflare-workers' && (
          <div className="mb-3 flex flex-col gap-3 rounded-(--radius-m) bg-fill p-4 text-caption">
            {cliPlatform && (
              <section className="flex flex-col gap-2" aria-label={t('Sign in with {0}', { 0: account.name })}>
                <strong>{t('Sign in with {0}', { 0: account.name })}</strong>
                <p className="m-0 text-muted-foreground">
                  {t(
                    'Runs {0}’s own sign-in on the host. Authorize Ramu in the page it opens; the token stays in this host’s credential store and your own CLI login is not changed.',
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
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(async () => {
                    await invoke('deploy.saveToken', account.platform, token.trim())
                    setToken('')
                    setOpen(false)
                    reload(false)
                  })
                }}
              >
                <strong>{account.cli ? t('Or use a token') : t('Connect with a token')}</strong>
                <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void openOnThisComputer('app.openExternal', account.tokenPage)}
                    >
                      {t('Open {0}’s token page', { 0: account.name })}
                    </Button>
                  </li>
                  <li>{t('Name it Ramu.')}</li>
                  <li>{t(SCOPE_HINT[account.platform])}</li>
                  <li>
                    {account.kind === 'hosting'
                      ? t('Set an expiry, then copy the token and paste it here.')
                      : t('Copy the key and paste it here.')}
                  </li>
                </ol>
                <label htmlFor={tokenId} className="flex flex-col gap-1">
                  {t('API token')}
                  <Input
                    id={tokenId}
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </label>
                <p className="m-0 text-muted-foreground">
                  {t(
                    'The token goes straight to the host’s credential store, is checked with {0}, and is never shown again.',
                    {
                      0: account.name,
                    },
                  )}
                </p>
                {error && (
                  <p role="alert" className="m-0 text-destructive">
                    {error}
                  </p>
                )}
                <span className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy || token.trim().length < 8}>
                    {busy ? t('Checking…') : t('Save')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={close}>
                    {t('Cancel')}
                  </Button>
                </span>
              </form>
            )}
          </div>
        )}
    </>
  )
}
