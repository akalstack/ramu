import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import type {
  AzureSummary,
  BitbucketSummary,
  ForgeConnectionSummary,
  ForgeSavedConnection,
  GitlabSummary,
} from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { BrandIcon } from '@/components/brand-icon'
import type { BrandId } from '@ramu/shared/brands'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useSettingsInvoke, useSingleSettingsHost } from './SettingsScope'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { invoke as openOnThisComputer } from '../ipc'
import { githubTokenLink } from '@ramu/shared/githubTokenLink'
import {
  BITBUCKET_TOKEN_LINK,
  azureOrganization,
  azureTokenLink,
  gitlabTokenLink,
  serverHost,
} from '@ramu/shared/forgeTokenLinks'
import { accountDetail, connectionHeadline, savedDetail } from './hostingStatus'
import { accountKey, forgeAccountKey } from '@ramu/shared/identities'
import { AccountIdentityPicker, IdentityDropdown, useAccountIdentities } from './AccountIdentity'

type Form = { replace: ForgeSavedConnection | null }

/** The field beside the token: a server, an account email or an organization. */
interface TokenField {
  label: string
  type: 'email' | 'text'
  required: boolean
  placeholder: string
  /** Shown under the field, such as when it may stay empty. */
  hint?: string
  /** Fixed while a credential is replaced, since the replacement is for the same server. */
  locked?: boolean
}

/**
 * Connecting a hosting service with a token, the same way for each: open the service's token page, paste the token,
 * Enter or Connect. The host checks it before saving and keeps it in its credential store, so a refusal stays here to
 * correct and nothing is stored or echoed in this window.
 */
function TokenForm({
  title,
  instructions,
  tokenLink,
  tokenLinkLabel,
  field,
  tokenLabel = t('API token'),
  minToken,
  initial = '',
  service,
  notes,
  alternative,
  choice,
  submitLabel = t('Connect'),
  onSave,
  onCancel,
}: {
  title: string
  instructions: string
  /** The page that makes the token, from what the field holds; `null` until the field says enough. */
  tokenLink: (value: string) => string | null
  tokenLinkLabel: string
  field: TokenField
  tokenLabel?: string
  minToken: number
  initial?: string
  /** Where the token is sent, from what the field holds. */
  service: (value: string) => string
  notes?: string
  /** Another way to connect, such as a CLI sign-in. */
  alternative?: ReactNode
  /** A small choice beside the submit action, such as which identity a further account is for. */
  choice?: ReactNode
  submitLabel?: string
  onSave: (field: string, token: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const tokenId = useId()
  const hintId = useId()
  const link = tokenLink(value)
  const ready = token.trim().length >= minToken && (!field.required || !!value.trim())
  return (
    <SettingsRow className="settings-stack gap-3!">
      <form
        className="flex flex-col gap-3"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || busy) return
          setBusy(true)
          setError(null)
          void onSave(value.trim(), token.trim()).then(
            () => setBusy(false),
            (reason) => {
              setBusy(false)
              setError(errorText(reason))
            },
          )
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <strong className="text-body">{title}</strong>
            <p className="m-0 text-caption text-muted-foreground">{instructions}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!link}
            title={link ? undefined : t('Fill in {0} first', { 0: field.label })}
            onClick={() => link && void openOnThisComputer('app.openExternal', link)}
          >
            {tokenLinkLabel}
            <ExternalLink data-icon="inline-end" />
          </Button>
        </div>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* One span, so the stacked label style keeps "optional" on the label's line. */}
            <label htmlFor={fieldId} className="text-caption">
              <span>
                {field.label}
                {!field.required && <span className="text-muted-foreground"> · {t('optional')}</span>}
              </span>
            </label>
            <Input
              id={fieldId}
              className="w-full!"
              type={field.type}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={field.placeholder}
              disabled={busy || field.locked}
              required={field.required}
              aria-describedby={field.hint ? hintId : undefined}
              autoFocus={field.required && !initial}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {field.hint && (
              <span id={hintId} className="text-caption text-muted-foreground">
                {field.hint}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={tokenId} className="text-caption">
              {tokenLabel}
            </label>
            <Input
              id={tokenId}
              className="w-full!"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('Paste the token')}
              disabled={busy}
              required
              autoFocus={!field.required || !!initial}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-destructive">
            {error}
            {STORE_FAILURE.test(error) && <RestartService />}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="m-0 min-w-0 flex-1 basis-64 text-caption text-muted-foreground">
            {t('The host checks the token, keeps it in its credential store and sends it only to {0}.', {
              0: service(value) || t('this server'),
            })}
            {notes ? ` ${notes}` : ''}
          </p>
          <span className="flex flex-wrap items-center gap-2">
            {choice}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy || !ready}>
              {busy ? t('Checking…') : submitLabel}
            </Button>
          </span>
        </div>
        {alternative}
      </form>
    </SettingsRow>
  )
}

/** How the host reports that it could not use its credential store. */
const STORE_FAILURE = /credential store is unavailable or locked/i

/**
 * After a Ramu rebuild or update, a background service still running the old code is refused the keychain until it
 * restarts; the host asks before restarting, since that stops running agents.
 */
function RestartService() {
  const invoke = useSettingsInvoke()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0"
        onClick={() => {
          setError(null)
          void Promise.resolve(invoke('background.restart')).catch((reason) => setError(errorText(reason)))
        }}
      >
        {t('Restart background service')}
      </Button>
      {error && <span>{error}</span>}
    </>
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ForgeSavedConnection | null>(null)
  const accountIdentities = useAccountIdentities()
  // Null follows the suggestion, which is known only once the identities have loaded.
  const [chosenIdentity, setChosenIdentity] = useState<string | null>(null)
  const forIdentity = chosenIdentity ?? accountIdentities.suggestedFor(accountKey('forge', 'github'))
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
        // Say nothing is known rather than that nothing is connected.
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
  // Accounts are connected on one machine: under All hosts the rows only report, until one host is chosen.
  const single = useSingleSettingsHost()
  const canAdminister = summary?.canAdminister !== false && single
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
    // Focus returns to where the form was opened from.
    opener.current?.focus()
  }
  // A failed check keeps the previous connection and throws, so the form stays open to correct the token.
  const save = async (origin: string, token: string) => {
    const connection = await invoke('forge.saveConnection', {
      origin: serverHost(origin),
      token,
      ...(form?.replace ? { replaceId: form.replace.id } : {}),
    })
    if (!form?.replace && further && forIdentity)
      await accountIdentities.assign(forgeAccountKey(connection.id)!, forIdentity)
    closeForm()
    check()
  }
  const origins = [...new Set(saved.map((connection) => connection.origin))]
  const hasCli = (summary?.accounts.length ?? 0) > 0
  // Only a further GitHub account asks which identity it is for; the first one is for every identity.
  const further = saved.length > 0 || hasCli

  return (
    <>
      <SettingsGroupTitle>{t('Hosting accounts')}</SettingsGroupTitle>
      {!single && (
        <p role="status" className="m-0 mb-3 text-caption text-muted-foreground">
          {t('Accounts connect on one host. Choose a host in the settings header to connect or change them.')}
        </p>
      )}
      <SettingsRow>
        <SettingsLabel title="GitHub" icon={<BrandIcon brand="github" />} help={connectionHeadline(summary, failed)} />
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
                setChosenIdentity(null)
                setForm({ replace: null })
              }}
            >
              {further ? t('Add account') : t('Connect')}
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
        <p
          role="status"
          className="m-0 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-caption text-muted-foreground"
        >
          {t(
            'The credential store on this host is locked or unavailable, so tokens cannot be saved. Unlock it on that machine and check again. Existing GitHub CLI sign-ins keep working.',
          )}
          {canAdminister && <RestartService />}
        </p>
      )}
      {single && !canAdminister && (
        <p className="m-0 mb-3 px-4 text-caption text-muted-foreground">
          {t('Add, replace or remove GitHub tokens on the machine running this host.')}
        </p>
      )}
      {actionError && (
        <p role="alert" className="m-0 mb-3 px-4 text-caption text-destructive">
          {actionError}
        </p>
      )}
      {form && canAdminister && (
        <TokenForm
          key={form.replace?.id ?? 'new'}
          title={form.replace ? t('Replace credential') : t('Connect GitHub')}
          instructions={t(
            'Create a fine-grained token limited to the repositories you need; the page opens with the permissions Ramu uses chosen. For GitHub Enterprise, change the server first.',
          )}
          tokenLink={(origin) => (serverHost(origin) ? githubTokenLink(serverHost(origin)) : null)}
          tokenLinkLabel={t('Create token on GitHub')}
          field={{
            label: t('Server'),
            type: 'text',
            required: true,
            placeholder: 'github.com',
            locked: !!form.replace,
          }}
          tokenLabel={t('Personal access token')}
          initial={form.replace?.origin ?? 'github.com'}
          minToken={8}
          service={serverHost}
          notes={t(
            'It covers pull requests, issues and checks; Git push and fetch keep using your own Git credentials.',
          )}
          submitLabel={form.replace ? t('Save') : t('Connect')}
          choice={
            !form.replace && further && accountIdentities.identities ? (
              <IdentityDropdown
                identities={accountIdentities.identities}
                caption={t('For')}
                label={t('Which identity uses it')}
                value={forIdentity}
                onChange={setChosenIdentity}
              />
            ) : undefined
          }
          onSave={save}
          onCancel={closeForm}
        />
      )}
      {open && summary && (
        <div id="github-accounts" className="mb-3 flex flex-col gap-3 px-4 text-caption">
          {saved.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('Saved tokens')}>
              {saved.map((connection) => (
                <li key={connection.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="min-w-0 flex-1">
                      <strong>{connection.login ?? t('Unknown account')}</strong>{' '}
                      <span className="text-muted-foreground">{connection.origin}</span>
                    </span>
                    <AccountIdentityPicker
                      accountKey={forgeAccountKey(connection.id)!}
                      name={connection.login ?? connection.origin}
                    />
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
                        onClick={() => setForm({ replace: connection })}
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
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="min-w-0 flex-1">
                      <strong>{account.login}</strong> <span className="text-muted-foreground">{account.host}</span>
                    </span>
                    <AccountIdentityPicker accountKey={forgeAccountKey(`cli:${account.login}`)!} name={account.login} />
                  </span>
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
      <GitlabRow canAdminister={canAdminister} />
      <BitbucketRow canAdminister={canAdminister} />
      <AzureRow canAdminister={canAdminister} />
    </>
  )
}

function gitlabHeadline(summary: GitlabSummary | null, failed: string | null) {
  if (failed) return failed
  if (!summary) return t('Checking…')
  if (!summary.accounts.length)
    return summary.cli === 'no-cli'
      ? t('Not signed in. Install glab and sign in, or set GITLAB_TOKEN on the host.')
      : t('Not signed in. Sign in with glab for gitlab.com or a self-managed server.')
  return summary.accounts
    .map((account) => {
      const via =
        account.source === 'saved'
          ? t('saved on this host')
          : account.source === 'cli'
            ? t('GitLab CLI')
            : 'GITLAB_TOKEN'
      if (account.state === 'failed') return `${account.origin}: ${account.error ?? t('Could not connect')}`
      return account.login
        ? t('Connected as {0} on {1} ({2})', { 0: account.login, 1: account.origin, 2: via })
        : t('Signed in on {0} ({1})', { 0: account.origin, 1: via })
    })
    .join(' · ')
}

/** GitLab merge requests, pipelines and issues use a token saved here, the host's own `glab` sign-in or `GITLAB_TOKEN`. */
function GitlabRow({ canAdminister }: { canAdminister: boolean }) {
  const invoke = useSettingsInvoke()
  const [summary, setSummary] = useState<GitlabSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback(
    (check: boolean) => {
      setBusy(check)
      setFailed(null)
      void Promise.resolve(invoke('forge.gitlab', check)).then(
        (next) => {
          setSummary(next)
          setBusy(false)
        },
        (reason) => {
          setFailed(errorText(reason))
          setBusy(false)
        },
      )
    },
    [invoke],
  )
  useEffect(() => load(false), [load])
  const [form, setForm] = useState(false)
  const saved = summary?.accounts.find((account) => account.source === 'saved')
  return (
    <>
      <SettingsRow>
        <SettingsLabel title="GitLab" icon={<BrandIcon brand="gitlab" />} help={gitlabHeadline(summary, failed)} />
        <span className="flex items-center gap-2">
          {!!summary?.accounts.length && (
            <Button variant="secondary" size="sm" aria-busy={busy} disabled={busy} onClick={() => load(true)}>
              {busy ? t('Checking…') : t('Check connection')}
            </Button>
          )}
          {canAdminister && !form && (
            <Button variant="secondary" size="sm" disabled={!summary} onClick={() => setForm(true)}>
              {saved ? t('Replace credential') : summary?.accounts.length ? t('Add account') : t('Connect')}
            </Button>
          )}
          {canAdminister && saved && !form && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void Promise.resolve(invoke('forge.removeGitlab')).then(setSummary, (reason) =>
                  setFailed(errorText(reason)),
                )
              }
            >
              {t('Disconnect')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {form && canAdminister && (
        <TokenForm
          title={saved ? t('Replace credential') : t('Connect GitLab')}
          instructions={t(
            'Create a personal access token with the api scope on your GitLab server; the page opens with it chosen. For a self-managed server, change the server first.',
          )}
          tokenLink={gitlabTokenLink}
          tokenLinkLabel={t('Create token on GitLab')}
          field={{ label: t('Server'), type: 'text', required: true, placeholder: 'gitlab.com' }}
          tokenLabel={t('Personal access token')}
          initial={saved?.origin ?? 'gitlab.com'}
          minToken={8}
          service={serverHost}
          submitLabel={saved ? t('Save') : t('Connect')}
          alternative={
            summary?.cli === 'installed' ? (
              <InlineAlternative
                text={t('Use the GitLab CLI?')}
                action={t('Sign in with glab instead')}
                onClick={() => {
                  setForm(false)
                  runProviderCommand(t('Sign in to GitLab'), 'glab auth login')
                  // The terminal finishes on its own time; read the sign-ins again when the person comes back.
                  window.addEventListener('focus', () => load(false), { once: true })
                }}
              />
            ) : summary?.cli === 'no-cli' ? (
              <InlineAlternative
                text={t('Prefer the GitLab CLI? Ramu also uses its sign-in.')}
                action={t('Install glab')}
                onClick={() =>
                  void openOnThisComputer('app.openExternal', 'https://gitlab.com/gitlab-org/cli#installation')
                }
              />
            ) : undefined
          }
          onCancel={() => setForm(false)}
          onSave={async (origin, token) => {
            setSummary(await invoke('forge.saveGitlab', { origin: serverHost(origin), token }))
            setForm(false)
          }}
        />
      )}
    </>
  )
}

/** A second way to connect, under a form's actions. */
function InlineAlternative({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 border-t border-edge pt-3 text-caption text-muted-foreground">
      {text}
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onClick}>
        {action}
      </Button>
    </p>
  )
}

/** What a token-based service's Settings row reads back from its host. */
interface TokenSummary {
  source: 'saved' | 'environment' | null
  login: string | null
  state: 'unchecked' | 'ok' | 'failed'
  error?: string
}

function tokenHeadline(
  summary: TokenSummary | null,
  failed: string | null,
  disconnected: string,
  shown: string | null,
) {
  if (failed) return failed
  if (!summary) return t('Checking…')
  if (!summary.source) return disconnected
  if (summary.state === 'failed') return summary.error ?? t('Could not connect')
  const via = summary.source === 'saved' ? t('saved on this host') : t('from the environment')
  const who = summary.login ?? shown
  return who ? t('Connected as {0} ({1})', { 0: who, 1: via }) : t('Connected ({0})', { 0: via })
}

/**
 * A service with no official CLI, connected with a token saved here or given in the environment: Bitbucket Cloud and
 * Azure DevOps. The token is checked on the host before it is saved.
 */
function TokenServiceRow<S extends TokenSummary>({
  canAdminister,
  title,
  brand,
  disconnected,
  form: formProps,
  shown,
  load,
  save,
  remove,
}: {
  canAdminister: boolean
  title: string
  brand: BrandId
  disconnected: string
  /** How the connect form reads for this service. */
  form: Pick<
    Parameters<typeof TokenForm>[0],
    'instructions' | 'tokenLink' | 'tokenLinkLabel' | 'field' | 'tokenLabel' | 'minToken' | 'service'
  >
  /** What the summary shows when it has no login, such as the email. */
  shown: (summary: S) => string | null
  load: (check: boolean) => Promise<S> | S
  save: (field: string, token: string) => Promise<S> | S
  remove: () => Promise<S> | S
}) {
  const [summary, setSummary] = useState<S | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [form, setForm] = useState(false)
  const call = useCallback((work: () => Promise<S> | S) => {
    setBusy(true)
    setFailed(null)
    void Promise.resolve()
      .then(work)
      .then(
        (next) => {
          setSummary(next)
          setBusy(false)
        },
        (reason) => {
          setFailed(errorText(reason))
          setBusy(false)
        },
      )
  }, [])
  const loadNow = useRef(load)
  loadNow.current = load
  useEffect(() => call(() => loadNow.current(false)), [call])
  const replacing = summary?.source === 'saved'
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={title}
          icon={<BrandIcon brand={brand} />}
          help={tokenHeadline(summary, failed, disconnected, summary ? shown(summary) : null)}
        />
        <span className="flex items-center gap-2">
          {summary?.source && (
            <Button
              variant="secondary"
              size="sm"
              aria-busy={busy}
              disabled={busy}
              onClick={() => call(() => load(true))}
            >
              {busy ? t('Checking…') : t('Check connection')}
            </Button>
          )}
          {canAdminister && !form && (
            <Button variant="secondary" size="sm" disabled={busy || !summary} onClick={() => setForm(true)}>
              {replacing ? t('Replace credential') : t('Connect')}
            </Button>
          )}
          {canAdminister && replacing && !form && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => call(remove)}>
              {t('Disconnect')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {form && canAdminister && (
        <TokenForm
          {...formProps}
          title={replacing ? t('Replace credential') : t('Connect {0}', { 0: title })}
          submitLabel={replacing ? t('Save') : t('Connect')}
          onCancel={() => setForm(false)}
          onSave={async (value, token) => {
            setSummary(await save(value, token))
            setForm(false)
          }}
        />
      )}
    </>
  )
}

/** Bitbucket Cloud has no official CLI: its credential is an API token saved here, or given in the environment. */
function BitbucketRow({ canAdminister }: { canAdminister: boolean }) {
  const invoke = useSettingsInvoke()
  return (
    <TokenServiceRow<BitbucketSummary>
      canAdminister={canAdminister}
      title="Bitbucket Cloud"
      brand="bitbucket"
      disconnected={t('Not connected. Connect to work with pull requests, builds and issues.')}
      form={{
        instructions: t(
          'Create an Atlassian API token with Bitbucket scopes for repositories, pull requests, pipelines and issues, then paste it here with the email of that account.',
        ),
        tokenLink: () => BITBUCKET_TOKEN_LINK,
        tokenLinkLabel: t('Create token on Atlassian'),
        field: {
          label: t('Atlassian account email'),
          type: 'email',
          required: false,
          placeholder: 'you@example.com',
          hint: t('Leave empty for a workspace or repository access token.'),
        },
        minToken: 8,
        service: () => 'api.bitbucket.org',
      }}
      shown={(summary) => summary.email}
      load={(check) => invoke('forge.bitbucket', check)}
      save={(email, token) => invoke('forge.saveBitbucket', { ...(email ? { email } : {}), token })}
      remove={() => invoke('forge.removeBitbucket')}
    />
  )
}

/** Azure DevOps' CLI is an `az` extension, so it connects with a personal access token, like Bitbucket. */
function AzureRow({ canAdminister }: { canAdminister: boolean }) {
  const invoke = useSettingsInvoke()
  return (
    <TokenServiceRow<AzureSummary>
      canAdminister={canAdminister}
      title="Azure DevOps"
      brand="azure-devops"
      disconnected={t('Not connected. Connect to work with pull requests, builds and work items.')}
      form={{
        instructions: t(
          'Create a personal access token with Code (read and write), Build (read) and Work Items (read) scopes in the organization.',
        ),
        tokenLink: azureTokenLink,
        tokenLinkLabel: t('Create token on Azure DevOps'),
        field: { label: t('Organization'), type: 'text', required: true, placeholder: 'contoso' },
        tokenLabel: t('Personal access token'),
        minToken: 20,
        service: () => 'dev.azure.com',
      }}
      shown={(summary) => summary.organization}
      load={(check) => invoke('forge.azure', check)}
      save={(organization, token) =>
        invoke('forge.saveAzure', { organization: azureOrganization(organization), token })
      }
      remove={() => invoke('forge.removeAzure')}
    />
  )
}
