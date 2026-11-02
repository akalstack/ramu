// Ramu Link and Cloudflare Tunnel: the two ways to reach this host from anywhere without a VPN, beside the network
// listener above them. Both are managed on this host only.
import { useState } from 'react'
import { Check, Copy, ExternalLink, Globe, LogIn } from 'lucide-react'
import type { NetworkStatus, TunnelMode } from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog as ConfirmDialog, Dropdown } from '../Menu'
import { copyText, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t } from '../i18n'
import { useSettingsInvoke } from './SettingsScope'

type Setter = (status: NetworkStatus) => void

const Note = ({ children, role }: { children: React.ReactNode; role?: 'status' | 'alert' }) => (
  <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role={role}>
    {children}
  </p>
)

function CopyValue({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(value).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        })
      }
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}

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
      <SettingsGroupTitle className="mt-5">{t('Ramu Link')}</SettingsGroupTitle>
      <Note>
        {t(
          'Reach this host from anywhere without a VPN or open ports. Sign in with Google or GitHub; your phone and other computers signed in to the same account find it. Connections are end-to-end encrypted, so the relay cannot read them.',
        )}
      </Note>
      {!link.account && !link.serviceFixed && (
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
            help={link.service ? undefined : t('Set the service address first.')}
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
    </>
  )
}

const tunnelStateText = (tunnel: NetworkStatus['tunnel']) =>
  tunnel.state === 'installing'
    ? t('Getting cloudflared…')
    : tunnel.state === 'starting'
      ? t('Starting the tunnel…')
      : tunnel.state === 'error'
        ? t('The tunnel stopped: {0}. Ramu tries again.', { 0: tunnel.error ?? '' })
        : null

export function TunnelSettings({ status, setStatus }: { status: NetworkStatus; setStatus: Setter }) {
  const invoke = useSettingsInvoke()
  const tunnel = status.tunnel
  const [mode, setMode] = useState<TunnelMode>(tunnel.mode)
  const [hostname, setHostname] = useState(tunnel.hostname ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<NetworkStatus>) => {
    setBusy(true)
    try {
      setStatus(await work())
    } catch (error) {
      notifyError(errorText(error), t('Cloudflare Tunnel'))
    } finally {
      setBusy(false)
    }
  }
  const choose = (next: TunnelMode) => {
    setMode(next)
    if (next !== 'named') void run(() => invoke('network.tunnelConfigure', { mode: next }))
  }
  const saveNamed = () =>
    void run(async () => {
      if (token.trim()) await invoke('network.tunnelSetToken', token.trim())
      setToken('')
      return invoke('network.tunnelConfigure', { mode: 'named', hostname: hostname.trim() })
    })
  const state = tunnelStateText(tunnel)
  return (
    <>
      <SettingsGroupTitle className="mt-5">{t('Cloudflare Tunnel')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel
          title={t('Public HTTPS address')}
          help={t(
            'A Cloudflare Tunnel gives this host an HTTPS address without opening a port or creating an account here. Devices still need to pair.',
          )}
        />
        <Dropdown
          label={t('Public HTTPS address')}
          value={mode}
          disabled={busy}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'quick', label: t('Temporary address') },
            { value: 'named', label: t('My own tunnel') },
          ]}
          onChange={(value) => choose(value as TunnelMode)}
        />
      </SettingsRow>
      {mode === 'quick' && (
        <Note>
          {t(
            'The address changes each time the tunnel restarts. Paired devices find it again through their other routes.',
          )}
        </Note>
      )}
      {mode === 'named' && (
        <>
          <SettingsRow>
            <SettingsLabel
              title={t('Public hostname')}
              help={t('In the Cloudflare dashboard, route this hostname to http://localhost:{0}.', {
                0: tunnel.originPort,
              })}
            />
            <Input
              aria-label={t('Public hostname')}
              placeholder="ramu.example.com"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
            />
          </SettingsRow>
          <SettingsRow>
            <SettingsLabel
              title={t('Tunnel token')}
              help={
                tunnel.hasToken
                  ? t('Saved in this computer’s credential store. Paste a new one to replace it.')
                  : t('From the Cloudflare dashboard. It is kept in this computer’s credential store.')
              }
            />
            <div className="flex gap-2">
              <Input
                aria-label={t('Tunnel token')}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy || !hostname.trim() || (!tunnel.hasToken && !token.trim())}
                onClick={saveNamed}
              >
                {t('Save')}
              </Button>
            </div>
          </SettingsRow>
        </>
      )}
      {tunnel.state === 'running' && tunnel.url && (
        <SettingsRow>
          <SettingsLabel title={t('Reachable at')} help={tunnel.url} />
          <div className="flex gap-1">
            <CopyValue value={tunnel.url} label={t('Copy address')} />
            <Globe size={14} className="text-muted-foreground self-center" aria-hidden />
          </div>
        </SettingsRow>
      )}
      {state && tunnel.mode !== 'off' && <Note role={tunnel.state === 'error' ? 'alert' : 'status'}>{state}</Note>}
    </>
  )
}
