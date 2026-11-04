// Ramu Link: the way to reach this host from anywhere without a VPN, beside the network listener above it. It is managed
// on this host only.
import { useState } from 'react'
import { ExternalLink, LogIn } from 'lucide-react'
import { DEFAULT_LINK_SERVICE } from '@ramu/shared/link/protocol'
import type { NetworkStatus } from '@ramu/shared/types'
import { RamuGlyph } from '../Brand'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog as ConfirmDialog } from '../Menu'
import { ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t } from '../i18n'
import { useSettingsInvoke } from './SettingsScope'
import { LinkPlanSettings } from './LinkPlan'

type Setter = (status: NetworkStatus) => void

const Note = ({ children, role }: { children: React.ReactNode; role?: 'status' | 'alert' }) => (
  <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role={role}>
    {children}
  </p>
)

const linkStateText = (status: NetworkStatus['link']) =>
  status.state === 'online'
    ? t('Connected. Devices signed in as {0} can reach this host from anywhere.', { 0: status.account?.email ?? '' })
    : status.state === 'connecting'
      ? t('Connecting to Ramu Link…')
      : status.state === 'offline'
        ? t('Ramu Link is unreachable right now. Ramu keeps trying.')
        : status.state === 'unauthorized'
          ? t('This host is no longer linked to your account. Sign in again.')
          : t('Off. Paired devices use this host’s other routes.')

export function LinkSettings({ status, setStatus }: { status: NetworkStatus; setStatus: Setter }) {
  const invoke = useSettingsInvoke()
  const link = status.link
  const [service, setService] = useState(link.service ?? '')
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Once a hosted service exists, choosing another one is an advanced step; until then it is the only way in.
  const ownService = DEFAULT_LINK_SERVICE === null || (link.service !== null && link.service !== DEFAULT_LINK_SERVICE)
  const [showService, setShowService] = useState(ownService)
  const run = async (work: () => Promise<NetworkStatus>) => {
    setBusy(true)
    try {
      setStatus(await work())
    } catch (error) {
      notifyError(errorText(error), t('Ramu Link'))
    } finally {
      setBusy(false)
    }
  }
  const open = (url: string) => void ramu.invoke('app.openExternal', url).catch(() => {})
  return (
    <>
      <SettingsGroupTitle className="flex items-center gap-1.5">
        <RamuGlyph size={12} />
        {t('Ramu Link')}
      </SettingsGroupTitle>
      {!link.account && !link.serviceFixed && !showService && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowService(true)}>
          {t('Use my own service…')}
        </Button>
      )}
      {!link.account && !link.serviceFixed && showService && (
        <SettingsRow>
          <SettingsLabel
            title={t('Service')}
            help={t('The address of a Ramu Link deployment. Run your own from apps/link in the Ramu repository.')}
          />
          <div className="flex gap-2">
            <Input
              aria-label={t('Service')}
              placeholder="https://link.example.com"
              value={service}
              onChange={(event) => setService(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={busy || service.trim() === (link.service ?? '')}
              onClick={() => void run(() => invoke('network.linkSetService', service.trim() || null))}
            >
              {t('Save')}
            </Button>
          </div>
        </SettingsRow>
      )}
      {link.account ? (
        <>
          <SettingsRow className="settings-toggle">
            <SettingsLabel title={t('Reach through Ramu Link')} help={linkStateText(link)} />
            <Switch
              aria-label={t('Reach through Ramu Link')}
              checked={link.enabled}
              disabled={busy}
              onCheckedChange={(checked) => void run(() => invoke('network.linkSetEnabled', checked))}
            />
          </SettingsRow>
          <SettingsRow>
            <SettingsLabel title={t('Account')} help={`${link.account.name} · ${link.account.email}`} />
            <Button variant="secondary" disabled={busy} onClick={() => setSigningOut(true)}>
              {t('Sign out…')}
            </Button>
          </SettingsRow>
          <LinkPlanSettings status={status} setStatus={setStatus} />
          <SettingsRow>
            <SettingsLabel
              title={t('Delete Ramu Link account')}
              help={t(
                'Removes the account, every host it links and its shares. A Plus subscription is cancelled first.',
              )}
            />
            <Button variant="ghost" className="text-bad" disabled={busy} onClick={() => setDeleting(true)}>
              {t('Delete account…')}
            </Button>
          </SettingsRow>
        </>
      ) : link.signIn ? (
        <SettingsRow>
          <SettingsLabel
            title={t('Confirm code {0}', { 0: link.signIn.userCode })}
            help={t(
              'Sign in with Google or GitHub on the page that opened, check that it shows this code, and approve.',
            )}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => open(link.signIn!.url)}>
              <ExternalLink size={14} />
              {t('Open sign-in page')}
            </Button>
            <Button variant="ghost" onClick={() => void run(() => invoke('network.linkCancelSignIn'))}>
              {t('Cancel')}
            </Button>
          </div>
        </SettingsRow>
      ) : (
        <SettingsRow>
          <SettingsLabel
            title={t('Sign in to Ramu Link')}
            help={
              link.service
                ? t(
                    'Reach this host from anywhere without a VPN or open ports. Devices signed in to the same Google or GitHub account find it; the relay cannot read the connection.',
                  )
                : t('Set the service address first.')
            }
          />
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={busy || !link.service}
            onClick={() =>
              void run(async () => {
                const next = await invoke('network.linkSignIn')
                if (next.link.signIn) open(next.link.signIn.url)
                return next
              })
            }
          >
            <LogIn size={14} />
            {t('Sign in…')}
          </Button>
        </SettingsRow>
      )}
      {link.error && link.state !== 'unauthorized' && <Note role="alert">{link.error}</Note>}
      {signingOut && (
        <ConfirmDialog
          danger
          title={t('Sign out of Ramu Link?')}
          confirmLabel={t('Sign out')}
          onCancel={() => setSigningOut(false)}
          onConfirm={() => {
            setSigningOut(false)
            void run(() => invoke('network.linkSignOut'))
          }}
        >
          <p>
            {t(
              'This host is unlinked from your account. Devices that reach it only through Ramu Link lose access until you sign in again; paired devices keep their other routes.',
            )}
          </p>
        </ConfirmDialog>
      )}
      {deleting && (
        <ConfirmDialog
          danger
          title={t('Delete your Ramu Link account?')}
          confirmLabel={t('Delete account')}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false)
            void run(() => invoke('network.linkDeleteAccount'))
          }}
        >
          <p>
            {t(
              'Every host linked to {0} is unlinked and devices lose their Ramu Link routes; paired devices keep their other routes. A Plus subscription is cancelled at once, without a refund for the rest of the period. This cannot be undone.',
              { 0: link.account?.email ?? '' },
            )}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
