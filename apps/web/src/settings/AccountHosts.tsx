// Hosts linked to this desktop's Ramu Link account. Signing in here lists them; choosing one asks it to pair through
// Link, and a person at that host allows it after comparing a six-digit number, as with a nearby host.
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, LogIn, Monitor, RefreshCw } from 'lucide-react'
import { DEFAULT_LINK_SERVICE } from '@ramu/shared/link/protocol'
import type { LinkAccountHost, LinkAccountStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { RowButton } from '@/components/row-button'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { timeAgo } from '../Menu'

export function AccountHosts({ onConnect }: { onConnect: (host: LinkAccountHost) => void }) {
  useLanguage()
  const [status, setStatus] = useState<LinkAccountStatus | null>(null)
  const [hosts, setHosts] = useState<LinkAccountHost[] | null>(null)
  const [service, setService] = useState('')
  const [busy, setBusy] = useState(false)
  // With a hosted service to fall back on, typing another address is an advanced step.
  const [showService, setShowService] = useState(DEFAULT_LINK_SERVICE === null)
  const load = useCallback(async () => {
    const next = await invoke('linkAccount.status')
    setStatus(next)
    setService((current) => current || next.service || '')
    setHosts(next.account ? await invoke('linkAccount.hosts').catch(() => []) : null)
  }, [])
  useEffect(() => {
    void load().catch(() => {})
    return ramu.on('linkAccount:changed', () => void load().catch(() => {}))
  }, [load])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
      await load()
    } catch (error) {
      notifyError(errorText(error), t('Ramu Link'))
    } finally {
      setBusy(false)
    }
  }
  if (!status) return null
  const serviceField = showService || (status.service !== null && status.service !== DEFAULT_LINK_SERVICE)
  const caption = 'm-0 text-caption text-muted-foreground'

  if (!status.account)
    return (
      <div className="flex flex-col gap-3">
        <p className={caption}>
          {t(
            'Sign in with the Google or GitHub account your hosts use for Ramu Link. They appear here and connect from anywhere, end-to-end encrypted.',
          )}
        </p>
        {!status.signIn && !serviceField && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowService(true)}>
            {t('Use my own service…')}
          </Button>
        )}
        {!status.signIn && serviceField && (
          <div className="flex gap-2">
            <Input
              className="bg-background"
              aria-label={t('Service')}
              placeholder="https://link.example.com"
              value={service}
              disabled={busy}
              onChange={(event) => setService(event.target.value)}
            />
            {service.trim() !== (status.service ?? '') && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => invoke('linkAccount.setService', service.trim() || null))}
              >
                {t('Save')}
              </Button>
            )}
          </div>
        )}
        {status.signIn ? (
          <div role="status" className="flex flex-col items-start gap-2 rounded-(--radius-m) bg-fill p-[14px_16px]">
            <span className="text-control">{t('Approve this code on the sign-in page')}</span>
            <span className="font-mono text-[24px] font-semibold tracking-[0.12em]">{status.signIn.userCode}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void ramu.invoke('app.openExternal', status.signIn!.url).catch(() => {})}
              >
                <ExternalLink size={14} />
                {t('Open sign-in page')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void run(() => invoke('linkAccount.cancelSignIn'))}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            className="self-start bg-fill hover:bg-fill-hover"
            disabled={busy || !status.service}
            onClick={() => void run(() => invoke('linkAccount.signIn'))}
          >
            <LogIn size={14} />
            {t('Sign in…')}
          </Button>
        )}
        {status.error && (
          <p className="m-0 text-caption text-bad" role="alert">
            {status.error}
          </p>
        )}
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">{t('Signed in as {0}', { 0: status.account.email })}</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Refresh')}
            title={t('Refresh')}
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => invoke('linkAccount.signOut'))}
          >
            {t('Sign out')}
          </Button>
        </div>
      </div>
      {hosts?.length ? (
        hosts.map((host) => (
          <RowButton
            key={host.hostId}
            disabled={busy || Boolean(host.pairedId) || !host.online}
            onClick={() => onConnect(host)}
            className="flex items-center gap-3 rounded-(--radius-m) px-3 py-3"
          >
            <Monitor size={16} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col items-start">
              <span className="text-control">{host.name}</span>
              <span className="text-caption text-muted-foreground">
                {host.sharedBy ? `${t('Shared by {0}', { 0: host.sharedBy })} · ` : ''}
                {host.pairedId
                  ? t('Already connected')
                  : host.online
                    ? t('Online')
                    : host.lastSeenAt
                      ? t('Offline, last seen {0}', { 0: timeAgo(host.lastSeenAt) })
                      : t('Offline')}
              </span>
            </span>
          </RowButton>
        ))
      ) : (
        <p className={caption}>
          {t(
            'No other hosts are linked to this account. On a host, turn on Ramu Link in Remote access or run ramu up.',
          )}
        </p>
      )}
    </div>
  )
}
