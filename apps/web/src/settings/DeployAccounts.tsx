import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { accountBrand } from '@ramu/shared/brands'
import type { AccountPlatform, HostingAccount, HostingAccountsSummary, HostingSignIn } from '@ramu/shared/types'
import {
  CLI_SIGN_IN_PLATFORMS,
  DEPLOY_ACCOUNT_GROUPS,
  REMOTE_SIGN_IN_PLATFORMS,
  SALESFORCE_CALLBACK,
  type CliSignInPlatform,
} from '@ramu/shared/types/deploy'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Checkbox } from '@/components/desktop-checkbox'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { invoke as openOnThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { useSettingsInvoke } from './SettingsScope'

/** What to pick on each platform's token page: the smallest scope it offers. */
const SCOPE_HINT: Record<AccountPlatform, string> = {
  vercel: 'Scope: the team your projects are in, not Full Account',
  netlify: 'Netlify tokens reach every team you belong to, so choose an expiry',
  railway: 'Pick the workspace your projects are in, so the token reaches only that workspace',
  cloudflare:
    'Create a custom token for the one account your apps go in, with Edit on only what your agent deploys (Workers Scripts, Cloudflare Pages, D1, Workers KV Storage or R2)',
  fly: 'Create an organization token for the organization your apps go in, rather than a personal access token',
  neon: 'Create a personal API key. Neon keys reach your whole account and do not expire, so revoke it on Neon when Ramu no longer needs it',
  supabase: 'Create an access token with an expiry. Supabase tokens reach every organization you belong to',
  grafana:
    'Create a service account with the Viewer role and a token for it, then paste your Grafana address and the token joined by | (https://acme.grafana.net|glsa_…). Dashboards read it only where you allow it',
  amplitude:
    'Copy the project’s API key and secret key from its settings and paste them joined by a colon (key:secret), with eu| before them for an EU project. Dashboards read it only where you allow it',
  salesforce:
    'Create a connected app in your org with OAuth on, the api and refresh_token scopes, PKCE required and no secret for the web server flow, and the callback below; then paste its consumer key here',
  expo: 'Create it for a robot user with the Developer role on the account that owns the app; a personal token reaches every account you belong to',
  gemini:
    'Create an API key in Google AI Studio on a project with billing turned on; video and music need the paid tier',
  elevenlabs: 'Create an API key with access to text to speech, music and sound effects',
  openai: 'Create a project API key; speech is billed to that project',
}

/** The headline under a platform's name: who is connected and how, or what to do. */
function deployAccountHeadline(account: HostingAccount): string {
  if (!account.connected)
    return account.kind === 'hosting'
      ? t('Not connected. Deploys and Publish to the web need an account.')
      : account.kind === 'cli'
        ? t('Not connected. Agents deploy here through its CLI with this account, asking before each change.')
        : account.kind === 'store'
          ? t('Not connected. Store releases of phone apps need an account.')
          : account.kind === 'service'
            ? t('Not connected. Dashboards that read it need an account.')
            : account.kind === 'media'
              ? t('Not connected. Abilities can use it for video, speech, music or sound effects.')
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
  const row = (account: HostingAccount) => (
    <DeployAccountRow key={account.platform} account={account} canAdminister={summary!.canAdminister} reload={load} />
  )
  return (
    <>
      {only
        ? summary?.accounts.filter((account) => account.kind === only).map(row)
        : DEPLOY_ACCOUNT_GROUPS.map((group) => {
            const accounts = summary?.accounts.filter((account) => account.kind === group.kind) ?? []
            return accounts.length ? (
              <section key={group.kind} className="mb-4">
                <SettingsGroupTitle>{t(group.title)}</SettingsGroupTitle>
                {accounts.map(row)}
              </section>
            ) : null
          })}
      {summary && !summary.canAdminister && only !== 'media' && (
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
  const [number, setNumber] = useState('')
  const [sandbox, setSandbox] = useState(false)
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
        <SettingsLabel title={account.name} icon={<BrandIcon brand={accountBrand(account.platform)} />} help={help} />
        <span className="flex items-center gap-2">
          {account.connected && (
            <Button variant="secondary" size="sm" onClick={() => reload(true)}>
              {t('Check connection')}
            </Button>
          )}
          {(canAdminister || remoteSignIn) && !open && (
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
      {open && (
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
          {canAdminister && account.platform === 'salesforce' && (
            <form
              className="flex flex-col gap-2"
              aria-label={t('Sign in with {0}', { 0: account.name })}
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => setSignIn(await invoke('deploy.salesforceSignIn', token.trim(), sandbox)))
              }}
            >
              <strong>{t('Sign in with {0}', { 0: account.name })}</strong>
              <p className="m-0 text-muted-foreground">{t(SCOPE_HINT.salesforce)}</p>
              <p className="m-0 text-muted-foreground">
                {t('Callback URL')} <code className="font-mono">{SALESFORCE_CALLBACK}</code>
              </p>
              <label htmlFor={tokenId} className="flex flex-col gap-1">
                {t('Consumer key')}
                <Input
                  id={tokenId}
                  value={token}
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={sandbox} onCheckedChange={(checked) => setSandbox(checked === true)} />
                {t('A sandbox org')}
              </label>
              {signIn?.state === 'waiting' && signIn.url && (
                <span className="flex flex-wrap items-center gap-2" role="status">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void openOnThisComputer('app.openExternal', signIn.url!)}
                  >
                    {t('Open the sign-in page')}
                  </Button>
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
                  <Button type="submit" size="sm" disabled={busy || token.trim().length < 10}>
                    {t('Sign in with {0}', { 0: account.name })}
                  </Button>
                </span>
              )}
            </form>
          )}
          {canAdminister && account.platform !== 'salesforce' && (
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
                <li>{t(SCOPE_HINT[account.platform as keyof typeof SCOPE_HINT])}</li>
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
