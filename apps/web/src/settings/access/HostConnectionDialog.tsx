import { useState } from 'react'
import type { Computer } from '@ramu/shared/types'
import { learnedRoutes } from '@ramu/shared/hostProof'
import { hostOfUrl, networkName, routeEncrypted, routeSpeed } from '@ramu/shared/networkLabel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DIALOG_SCROLLS, DialogScrollBody } from '@/components/dialog-scroll-body'
import { Dialog as ConfirmDialog, Dropdown } from '../../Menu'
import { invoke } from '../../ipc'
import { errorText } from '../../lib/errors'
import { t } from '../../i18n'
import { CopyButton } from '../CopyAddressButton'
import { HostPermissionList } from '../DevicePermissions'

const AUTOMATIC = 'automatic'

/** One other host's connection as this device keeps it: its name, network, reconnecting and what it may do there. */
export function HostConnectionDialog({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const [name, setName] = useState(computer.name),
    [enabled, setEnabled] = useState(computer.enabled !== false)
  const [retryMode, setRetryMode] = useState(computer.retryMode ?? 'events'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const routes =
    computer.url && !computer.ssh
      ? learnedRoutes([computer.url, ...(computer.routes ?? [])]).sort((a, b) => routeSpeed(a) - routeSpeed(b))
      : []
  // Leaving an encrypted route for the plain local network asks once per host; after that, Automatic may use it too.
  const [askLan, setAskLan] = useState<string | null>(null)
  const automatic = computer.routeMode !== 'manual'
  const chooseNetwork = (next: string) => {
    if (next === AUTOMATIC) return void setAutomatic()
    if (computer.url && routeEncrypted(computer.url) && !routeEncrypted(next) && !computer.plainLan)
      return setAskLan(next)
    void switchNetwork(next)
  }
  const setAutomatic = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('computers.update', computer.id, { routeMode: 'auto' })
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const switchNetwork = async (url: string, allowPlain = false) => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('computers.reviewAddress', computer.id, url, allowPlain)
      if (result === 'mismatch')
        setError(
          t('That address did not prove it is {0}, so nothing changed. Pair it again to add it as a new host.', {
            0: computer.name,
          }),
        )
      else if (result === 'unsupported')
        setError(
          t('{0} was paired before Ramu could check hosts. Pair it again to use this address.', { 0: computer.name }),
        )
      else if (result === 'insecure')
        setError(
          t(
            'That address is not encrypted, and {0} was paired over an encrypted connection. Pair it again to use it.',
            { 0: computer.name },
          ),
        )
      else if (result === 'unreachable') setError(t('Could not reach that network to check it. Nothing changed.'))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('computers.update', computer.id, { name: name.trim(), enabled, retryMode })
      onClose()
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className={`${DIALOG_SCROLLS} sm:max-w-[540px]`}>
        <DialogHeader>
          <DialogTitle>{t('Connection settings')}</DialogTitle>
          <DialogDescription>
            {t('Saved on this device. The other host’s projects and settings stay as they are.')}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
              {t('Name')}
              <Input
                aria-label={t('Host name')}
                maxLength={60}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="rounded-(--radius-s) bg-fill px-3 py-2">
              <div className="flex items-center gap-2">
                <code className="min-w-0 grow truncate text-caption" title={computer.url ?? ''}>
                  {computer.url}
                </code>
                <CopyButton text={computer.url ?? ''} label={t('Copy address')} />
              </div>
              <p className="m-0 text-caption text-muted-foreground">
                {computer.url?.startsWith('https:')
                  ? t('HTTPS connection')
                  : computer.url && routeEncrypted(computer.url)
                    ? t('Encrypted by your VPN')
                    : t('Not encrypted · anyone on this network could read it')}
                {computer.pairedAt
                  ? ` · ${t('Paired {0}', { 0: new Date(computer.pairedAt).toLocaleDateString() })}`
                  : ''}
              </p>
            </div>
            {routes.length > 1 && (
              <div className="flex items-center justify-between gap-4">
                <span>
                  <strong className="text-body font-medium">{t('Network')}</strong>
                  <span className="block mt-1 text-caption text-muted-foreground">
                    {t('Automatic uses the fastest that answers: local network, then VPN, then Ramu Link.')}
                  </span>
                </span>
                <Dropdown
                  label={t('Network')}
                  value={automatic ? AUTOMATIC : (computer.url ?? '')}
                  disabled={busy}
                  options={[
                    {
                      value: AUTOMATIC,
                      label: computer.url
                        ? `${t('Automatic')} · ${t(networkName(hostOfUrl(computer.url)))}`
                        : t('Automatic'),
                    },
                    ...routes.map((route) => ({
                      value: route,
                      label: `${t(networkName(hostOfUrl(route)))} · ${hostOfUrl(route)}`,
                    })),
                  ]}
                  onChange={chooseNetwork}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <span>
                <strong className="text-body font-medium">{t('Keep connected')}</strong>
                <span className="block mt-1 text-caption text-muted-foreground">
                  {t(
                    'Turn off to pause this connection without forgetting it. Ramu stops retrying and listening for announcements while paused.',
                  )}
                </span>
              </span>
              <Switch aria-label={t('Keep connected')} checked={enabled} disabled={busy} onCheckedChange={setEnabled} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-body">{t('Reconnect')}</span>
              <Dropdown
                label={t('Reconnect')}
                value={retryMode}
                disabled={busy || !enabled}
                options={[
                  { value: 'events', label: t('When the network or host returns') },
                  { value: 'periodic', label: t('Also check every five minutes') },
                ]}
                onChange={(value) => setRetryMode(value as 'events' | 'periodic')}
              />
            </div>
            <p className="m-0 text-caption text-muted-foreground">
              {retryMode === 'events'
                ? t(
                    'Waits for a network change, wake from sleep, a signed host announcement, or Retry. No periodic checks.',
                  )
                : t(
                    'Uses the same signals, plus a quiet check every five minutes in case announcements cannot reach this device.',
                  )}
            </p>
            <p className="m-0 text-caption text-muted-foreground">
              {t(
                'Host announcements need a LAN or VPN path. If your network blocks them, use Retry or turn on five-minute checks.',
              )}
            </p>
            {computer.status === 'connected' && (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <strong className="text-body font-medium">{t('What this device may do there')}</strong>
                <HostPermissionList computer={computer} />
              </div>
            )}
            {error && (
              <p role="alert" className="m-0 text-caption text-bad">
                {error}
              </p>
            )}
          </div>
        </DialogScrollBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="default" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? t('Saving…') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
      {askLan && (
        <ConfirmDialog
          title={t('Use the local network for {0}?', { 0: computer.name })}
          confirmLabel={t('Use local network')}
          onConfirm={() => {
            const next = askLan
            setAskLan(null)
            void switchNetwork(next, true)
          }}
          onCancel={() => setAskLan(null)}
        >
          <p className="m-0">
            {t(
              'It is the fastest route, but Ramu does not encrypt it: others on this Wi-Fi could read what is sent. Ramu will then use it on its own whenever it answers.',
            )}
          </p>
        </ConfirmDialog>
      )}
    </Dialog>
  )
}
