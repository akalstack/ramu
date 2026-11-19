import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, UserRound } from 'lucide-react'
import type { ForgeConnectionSummary } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { invoke } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { AccountAvatar, useOwnAccount } from '../settings/AccountProfile'
import { connectionHeadline } from '../settings/hostingStatus'
import { githubSetup } from './githubSetup'
import { Group, Row } from './parts'

/**
 * The optional Ramu account, offered where setup is about reaching this host from other devices: signing in opens
 * the sign-in page straight away, and once signed in one switch lists the host so those devices connect without a
 * code. Nothing shows for a host whose account this device may not read.
 */
export function AccountSignIn({ onError }: { onError(message: string): void }) {
  const account = useOwnAccount()
  const [busy, setBusy] = useState(false)
  if (!account) return null
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    onError('')
    try {
      await work()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const pending = account.pendingSignIn
  const user = account.signedIn ? account.user : null
  if (user)
    return (
      <Group>
        <Row
          title={
            <>
              <AccountAvatar user={user} size={20} />
              {user.name || user.email}
            </>
          }
          help={t('Signed in to your Ramu account. Turn on backups in Settings › Account.')}
        />
        <Row
          title={t('Let my signed-in devices connect')}
          help={t(
            'Your phone and other computers signed in to this account connect with full access, without a code. Change the access in Settings › Account.',
          )}
        >
          <Switch
            aria-label={t('Let my signed-in devices connect')}
            checked={account.listed}
            disabled={busy}
            onCheckedChange={(checked) => void run(() => invoke('account.setListed', checked))}
          />
        </Row>
      </Group>
    )
  if (pending)
    return (
      <Group>
        <Row
          title={t('Code: {code}', { code: pending.userCode })}
          help={t('Sign in with GitHub, Google or a passkey, check the code matches and choose Approve.')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void invoke('app.openExternal', pending.verificationUri)}
          >
            {t('Open the sign-in page')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => invoke('account.cancelSignIn'))}
          >
            {t('Cancel')}
          </Button>
        </Row>
      </Group>
    )
  return (
    <Group>
      <Row
        title={
          <>
            <UserRound size={15} className="text-muted-foreground" />
            {t('Ramu account')}
          </>
        }
        help={t(
          'Optional and free. Sign in so your signed-in phone and computers connect without a code, and to back up your settings.',
        )}
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const started = await invoke('account.signIn')
              await invoke('app.openExternal', started.verificationUri)
            })
          }
        >
          {t('Sign in')}
        </Button>
      </Row>
    </Group>
  )
}

/**
 * GitHub on this host, shown with the identities: pull requests, issues and reviews need it, commits do not. A
 * signed-out GitHub CLI signs in from a terminal here; a missing one points to its setup page.
 */
export function GitHubSignIn() {
  const [summary, setSummary] = useState<ForgeConnectionSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const check = useCallback(() => {
    setChecking(true)
    setFailed(false)
    void invoke('forge.connections')
      .then(setSummary, () => setFailed(true))
      .finally(() => setChecking(false))
  }, [])
  useEffect(check, [check])
  const setup = summary && githubSetup(summary)
  return (
    <Group>
      <Row
        title={
          <>
            <BrandIcon brand="github" size={15} />
            GitHub
          </>
        }
        help={
          setup === 'ready'
            ? connectionHeadline(summary, failed)
            : `${connectionHeadline(summary, failed)} ${t('Pull requests, issues and reviews need it; commits work without it.')}`
        }
      >
        {setup === 'sign-in' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runProviderCommand(`GitHub · ${t('Sign in')}`, 'gh auth login --web')}
          >
            {t('Sign in')}
          </Button>
        )}
        {setup === 'install' && (
          <Button size="sm" variant="ghost" onClick={() => void invoke('app.openExternal', 'https://cli.github.com')}>
            {t('Setup instructions')}
            <ExternalLink size={13} />
          </Button>
        )}
        {setup !== 'ready' && (
          <Button size="sm" variant="ghost" aria-busy={checking} disabled={checking} onClick={check}>
            {checking ? t('Checking…') : t('Check again')}
          </Button>
        )}
      </Row>
    </Group>
  )
}
