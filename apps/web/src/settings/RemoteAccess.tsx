import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'
import QRCode from 'qrcode'
import { encodePairLink, encodePairQr, parsePairInput } from '@ramu/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SETTINGS_CARD_LINE } from './cards'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Check, ChevronDown, Copy, Link2, MoreHorizontal, Plus, Radar } from 'lucide-react'
import { useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AgentHostSummary,
  Computer,
  Computers as ComputerList,
  DeviceOs,
  NetworkDevice,
  NetworkStatus,
  PairingOffer,
} from '@ramu/shared/types'
import { DEVICE_PERMISSIONS } from '@ramu/shared/devicePermissions'
import { RowButton } from '@/components/row-button'
import { Dialog as ConfirmDialog, Dropdown, Menu, timeAgo } from '../Menu'
import { learnedRoutes } from '@ramu/shared/hostProof'
import { hostOfUrl, networkName, VIRTUAL_INTERFACE } from '@ramu/shared/networkLabel'
import { copyText, invoke, invokeOn, invokeUncachedOn, ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'
import { activityText, hostRoute, StatusDot, statusText, useComputers } from '../workspace/computers'
import { workspaceVisible } from '../workspace/workspaceLifetime'
import { onPairLink, takePairLink } from '../pairLink'
import { NearbyHosts } from './NearbyHosts'
import { AgentHosts } from './AgentHosts'
import { LinkSettings } from './ReachThisHost'
import { AccountHosts } from './AccountHosts'
import { HostUpdateLine, UpdateAllHosts } from './HostUpdates'
import { DeviceIcon } from '@/components/device-icon'
import { DIALOG_SCROLLS, DialogScrollBody } from '@/components/dialog-scroll-body'
import { osLine } from '@ramu/shared/deviceOs'
import { isSshTarget } from '@ramu/shared/hostTarget'
import { RamuGlyph } from '../Brand'
import { useStagedValue } from './stagedChanges'
import { agentReachable, agentsOnEverywhere } from './agentHostLinks'
import {
  DefaultPermissions,
  DevicePermissionList,
  HostAccess,
  HostCeiling,
  HostPermissionList,
  PermissionRequests,
  type PermissionInvoke,
} from './DevicePermissions'

const ALL_NETWORKS = '0.0.0.0'
const DEFAULT_PORT = 7788
const validPort = (port: number) => Number.isInteger(port) && port >= 1024 && port <= 65535

/** `m:ss` left until a pairing code expires. */
const countdown = (expiresAt: number, now: number) => {
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** Polls while the screen is open: pairing happens on another device, so nothing here would otherwise know it finished. */
function useNetworkStatus(interval: number) {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const loading = useRef(false)
  const reload = useCallback(async () => {
    if (!workspaceVisible() || loading.current) return
    loading.current = true
    try {
      setStatus(await invoke('network.status'))
    } catch {
    } finally {
      loading.current = false
    }
  }, [invoke])
  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), interval)
    return () => window.clearInterval(id)
  }, [reload, interval])
  return [status, setStatus, reload] as const
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(text).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        })
      }
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  )
}

export function RemoteAccessSettings() {
  useLanguage()
  const state = useComputers()
  const settingsScope = useContext(SettingsScopeContext)
  if (!state) return null
  const here = state.computers.find((computer) => computer.id === (settingsScope?.primaryId ?? state.current))
  return (
    <div className="settings-form flex flex-col gap-0">
      <Computers state={state} />
      <Section
        title={t('Let other devices use this host')}
        help={
          here?.local === false
            ? t('You are looking at {0}. Who can connect to a host is set on that host.', { 0: here.name })
            : t('Phones and your other computers reach it through Ramu Link or your network, after you pair them.')
        }
      >
        {here?.local !== false && <ThisComputer />}
      </Section>
    </div>
  )
}

function ThisComputer() {
  const invoke = useSettingsInvoke()
  const [status, setStatus, reload] = useNetworkStatus(2500)
  const [confirm, setConfirm] = useState(false),
    [pairing, setPairing] = useState(false),
    [revoking, setRevoking] = useState<string | null>(null)
  const [config, stageConfig] = useStagedValue(
    'network.config',
    {
      enabled: !!status?.enabled,
      host: status?.host ?? ALL_NETWORKS,
      port: String(status?.port ?? DEFAULT_PORT),
      discoverable: status?.discovery?.discoverable,
    },
    async ({ port: chosen, discoverable, ...rest }) => {
      if (!validPort(Number(chosen))) throw new Error(t('Use a number from 1024 to 65535.'))
      try {
        setStatus(
          await invoke('network.configure', {
            ...rest,
            port: Number(chosen),
            acceptUnencrypted: true,
            // Older hosts have no such setting; leaving it out keeps whatever they saved.
            ...(discoverable === undefined ? {} : { discoverable }),
          }),
        )
      } catch (error) {
        notifyError(errorText(error), t('Remote access'))
      }
    },
  )
  const { host, port } = config
  const [lifetime, stageLifetime] = useStagedValue(
    'network.deviceLifetime',
    String(status?.deviceLifetime?.days),
    async (value) => {
      try {
        setStatus(
          await invoke(
            'network.setDeviceLifetime',
            value === 'default' ? null : value === 'never' ? 'never' : Number(value),
          ),
        )
      } catch (error) {
        notifyError(errorText(error), t('Remote access'))
      }
    },
  )
  if (!status) return null
  const managed = status.source === 'command-line'
  const portValid = validPort(Number(port))
  const options = [
    { value: ALL_NETWORKS, label: t('All networks') },
    ...status.addresses
      .filter(
        (entry) => entry.address === host || (!VIRTUAL_INTERFACE.test(entry.name) && !entry.address.includes(':')),
      )
      .map((entry) => ({
        value: entry.address,
        label: `${t(networkName(entry.address, entry.name))} · ${entry.name} · ${entry.address}`,
      })),
  ]
  if (!options.some((option) => option.value === host)) options.push({ value: host, label: host })
  const changePermission: PermissionInvoke = async (method, ...args) => {
    try {
      setStatus(await (invoke as (method: string, ...args: unknown[]) => Promise<NetworkStatus>)(method, ...args))
    } catch (error) {
      notifyError(errorText(error), t('Remote access'))
    }
  }
  const revoke = async (id: string) => {
    try {
      setStatus(await invoke('network.revoke', id))
    } catch (error) {
      notifyError(errorText(error), t('Remote access'))
    }
  }
  const listening = status.listening ? `${status.tls ? 'https' : 'http'}://${status.host}:${status.port}` : null
  return (
    <>
      <AgentHosts />
      <LinkSettings status={status} setStatus={setStatus} />
      <SettingsGroupTitle className="mt-5">{t('Local network or VPN')}</SettingsGroupTitle>
      <SettingsRow className="settings-toggle">
        <SettingsLabel
          title={t('Allow other devices')}
          help={
            managed
              ? t('Set when Ramu was started with --listen. Change it there.')
              : t('Phones and other hosts can use this host’s threads, files and terminals after you pair them.')
          }
        />
        <Switch
          aria-label={t('Allow other devices')}
          checked={config.enabled}
          disabled={managed || (!config.enabled && !portValid)}
          onCheckedChange={(checked) => {
            if (!checked || status.tls || /^(127\.|::1$)/.test(host)) stageConfig({ ...config, enabled: checked })
            else setConfirm(true)
          }}
        />
      </SettingsRow>
      {!managed && config.enabled && (
        <SettingsRow>
          <SettingsLabel
            title={t('Network')}
            help={t(
              'Other devices connect to and find this host only on this network. Choose your VPN to keep Ramu off other networks.',
            )}
          />
          <Dropdown
            label={t('Network')}
            value={host}
            options={options}
            onChange={(next) => stageConfig({ ...config, host: next })}
          />
        </SettingsRow>
      )}
      {status.discovery && config.enabled && (
        <>
          <SettingsRow className="settings-toggle">
            <SettingsLabel
              title={t('Discoverable on this network')}
              help={
                managed
                  ? t('Set with --discoverable when Ramu was started with --listen.')
                  : t(
                      'Devices on the same network can see this host’s name ({0}) while pairing. Finding a host never gives access; they still need a pairing code. Off by default.',
                      { 0: status.discovery.name },
                    )
              }
            />
            <Switch
              aria-label={t('Discoverable on this network')}
              checked={!!config.discoverable}
              disabled={managed || !config.enabled}
              onCheckedChange={(checked) => stageConfig({ ...config, discoverable: checked })}
            />
          </SettingsRow>
          {status.enabled && status.discovery.discoverable && (
            <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role="status">
              {status.discovery.state === 'advertising'
                ? t('Visible as {0} on {1}', {
                    0: status.discovery.name,
                    1: status.discovery.interfaces.join(', '),
                  })
                : status.listening
                  ? t('Not visible right now ({0}). Pairing by address or QR code still works.', {
                      0: status.discovery.error ?? t('no network to advertise on'),
                    })
                  : t('Starting…')}
            </p>
          )}
        </>
      )}
      {status.enabled && (
        <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role="status">
          {listening
            ? t('Listening on {0}', { 0: listening.replace(/^https?:\/\//, '') })
            : status.error
              ? t('Cannot listen on {0}:{1} ({2}). Local use is unaffected; Ramu keeps retrying.', {
                  0: status.host,
                  1: status.port,
                  2: status.error,
                })
              : t('Starting…')}
        </p>
      )}
      {!status.tls && status.enabled && !/^(127\.|::1$)/.test(status.host) && (
        <p className="muted text-muted-foreground small text-caption m-[0_0_12px]">
          {t('Ramu does not encrypt this connection. Use it on a VPN or a network you trust.')}
        </p>
      )}

      <div>
        <SettingsRow>
          <SettingsLabel
            title={t('Pair a device')}
            help={
              status.reachable
                ? t(
                    'Creates a one-time code for a phone or another host. With Discoverable on, nearby devices can also ask, and you allow them here.',
                  )
                : t('Turn on a way in above first: other devices or Ramu Link.')
            }
          />
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={!status.reachable}
            onClick={() => setPairing(true)}
          >
            <Link2 size={14} />
            {t('Pair a device…')}
          </Button>
        </SettingsRow>
      </div>
      <SettingsGroupTitle className="mt-5">{t('Devices that can use this host')}</SettingsGroupTitle>
      <PermissionRequests status={status} invoke={changePermission} />
      {status.devices.map((device) => (
        <PairedDeviceRow
          key={device.id}
          device={device}
          invoke={changePermission}
          onRevoke={() => setRevoking(device.id)}
          hostDays={status.deviceLifetime.days}
        />
      ))}
      {!status.devices.length && (
        <p className="muted text-muted-foreground small text-caption m-[0_0_12px]">{t('No devices paired yet.')}</p>
      )}
      <Collapsible className="mt-3">
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="group/options text-caption text-muted-foreground" />}
        >
          {t('Advanced')}
          <ChevronDown size={14} className="transition-transform group-data-[panel-open]/options:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {!managed && (
            <SettingsRow>
              <SettingsLabel title={t('Port')} help={portValid ? undefined : t('Use a number from 1024 to 65535.')} />
              <Input
                aria-label={t('Port')}
                inputMode="numeric"
                value={port}
                aria-invalid={!portValid}
                onChange={(event) =>
                  stageConfig({ ...config, port: event.target.value.replace(/\D/g, '').slice(0, 5) })
                }
              />
            </SettingsRow>
          )}
          {status.deviceLifetime && (
            <SettingsRow>
              <SettingsLabel
                title={t('Keep devices paired')}
                help={t(
                  'A device that is not used for this long must be paired again. Using it renews the time. Changes apply the next time each device connects.',
                )}
              />
              <Dropdown
                label={t('Keep devices paired')}
                value={lifetime}
                options={lifetimeOptions(status.deviceLifetime.days, status.deviceLifetime.saved)}
                onChange={stageLifetime}
              />
            </SettingsRow>
          )}
          <DefaultPermissions status={status} invoke={changePermission} />
        </CollapsibleContent>
      </Collapsible>

      {confirm && (
        <ConfirmDialog
          title={t('Allow other devices?')}
          confirmLabel={t('Turn on')}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            stageConfig({ ...config, enabled: true })
          }}
        >
          <p>
            {t(
              'Ramu does not encrypt this connection. Anyone on that network could read what a paired device sends. Turn it on only for a VPN such as Tailscale, NetBird or ZeroTier, or a network you trust. Devices still need a pairing code.',
            )}
          </p>
        </ConfirmDialog>
      )}
      {revoking !== null && (
        <ConfirmDialog
          danger
          title={t('Revoke {0}?', { 0: status.devices.find((device) => device.id === revoking)?.name ?? '' })}
          confirmLabel={t('Revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            if (revoking) void revoke(revoking)
            setRevoking(null)
          }}
        >
          <p>{t('It stops working right away and has to be paired again to reconnect.')}</p>
        </ConfirmDialog>
      )}
      {pairing && (
        <PairDialog
          onClose={() => {
            setPairing(false)
            void reload()
          }}
        />
      )}
    </>
  )
}

function PairDialog({ onClose }: { onClose: () => void }) {
  const invoke = useSettingsInvoke()
  const [offer, setOffer] = useState<PairingOffer | null>(null),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<'owner' | 'viewer'>('owner')
  const [qr, setQr] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  useEffect(() => {
    let alive = true
    setQr('')
    if (offer && offer.urls.length) {
      const url = qrUrl || offer.urls[0]!.url
      void QRCode.toDataURL(encodePairQr({ url, code: offer.code, expiresAt: offer.expiresAt }), {
        width: 240,
        margin: 2,
      }).then(
        (value) => {
          if (alive) setQr(value)
        },
        () => {},
      )
    }
    return () => {
      alive = false
    }
  }, [offer, qrUrl])
  const [joined, setJoined] = useState<{ name: string; role: 'owner' | 'viewer' } | null>(null),
    [showOther, setShowOther] = useState(false)
  const offerRequest = useRef(0)
  // One owner per dialog: a new code (or a role change) replaces this dialog's unused one on the host.
  const owner = useRef(crypto.randomUUID()).current
  const create = useCallback(() => {
    const request = ++offerRequest.current
    setError(null)
    setJoined(null)
    setOffer(null)
    invoke('network.pair', role, owner).then(
      (next) => {
        if (request === offerRequest.current) setOffer(next)
      },
      (e) => {
        if (request === offerRequest.current) setError(errorText(e))
      },
    )
  }, [invoke, role, owner])
  useEffect(() => {
    create()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++offerRequest.current
    }
  }, [create])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const offerId = offer?.offerId
  useEffect(() => {
    if (!offerId || joined) return
    let live = true
    const check = () =>
      invoke('network.offer', offerId).then(
        (result) => {
          if (!live) return
          if (result.state === 'redeemed' && result.device)
            setJoined({ name: result.device.name, role: result.device.role ?? 'owner' })
        },
        () => {},
      )
    const id = window.setInterval(() => void check(), 1500)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [invoke, offerId, joined])
  // Closing the dialog withdraws an unused code; a crash still relies on its expiry.
  useEffect(() => {
    if (!offerId) return
    return () => {
      void Promise.resolve(invoke('network.cancelOffer', offerId)).catch(() => {})
    }
  }, [invoke, offerId])
  const expired = !!offer && offer.expiresAt <= now
  // IPv4 first: they are shorter and what people type. Link-local and loopback are already left out.
  const sorted = offer ? [...offer.urls].sort((a, b) => Number(a.url.includes('[')) - Number(b.url.includes('['))) : []
  const likely = sorted.filter((entry) => !VIRTUAL_INTERFACE.test(entry.interface)),
    other = sorted.filter((entry) => VIRTUAL_INTERFACE.test(entry.interface))
  const urls = showOther || !likely.length ? sorted : likely
  const hidden = sorted.length - urls.length
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className={`${DIALOG_SCROLLS} sm:max-w-[520px]`} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{joined ? t('{0} is paired', { 0: joined.name }) : t('Pair a device')}</DialogTitle>
          {!joined && (
            <DialogDescription>
              {t(
                'On the other device open Ramu and choose this host under Nearby hosts; you will be asked to allow it when both show the same number. Or enter one of these addresses and the code.',
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogScrollBody>
          {!joined && (
            <Dropdown
              label={t('Device access')}
              value={role}
              options={[
                { value: 'owner', label: t('Full access') },
                { value: 'viewer', label: t('View threads and answer requests') },
              ]}
              onChange={(value) => setRole(value as 'owner' | 'viewer')}
            />
          )}
          {error && (
            <p className="text-bad small text-caption" role="alert">
              {error}
            </p>
          )}
          {joined ? (
            <p className="muted text-muted-foreground">
              {t(joined.role === 'viewer' ? 'View threads and answer requests' : 'Full access')}
              {' · '}
              {t('It can now use this host. You can revoke it any time from Devices that can use this host.')}
            </p>
          ) : (
            offer && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-(--radius-m) bg-fill p-[14px_16px]">
                  <div>
                    <span className="sr-only">{t('Pairing code')}</span>
                    <div
                      className={`font-mono text-[28px] font-semibold tracking-[0.12em] ${expired ? 'text-muted-foreground line-through' : ''}`}
                    >
                      {offer.code}
                    </div>
                    <div className="muted text-muted-foreground small text-caption">
                      {expired
                        ? t('Expired')
                        : t('Works once · expires in {0}', { 0: countdown(offer.expiresAt, now) })}
                    </div>
                  </div>
                  {expired ? (
                    <Button variant="secondary" onClick={create}>
                      {t('New code')}
                    </Button>
                  ) : (
                    <CopyButton text={offer.code} label={t('Copy code')} />
                  )}
                </div>
                {!expired && offer.urls.length > 0 && (
                  <div className="flex items-center gap-2 rounded-(--radius-s) bg-fill p-[4px_6px_4px_12px]">
                    <Link2 size={14} className="flex-none text-muted-foreground" aria-hidden />
                    <span className="grow flex-1 min-w-0 truncate text-control">{t('Pairing link')}</span>
                    <span className="muted text-muted-foreground small text-caption flex-none">
                      {t('Open it on a device that has Ramu')}
                    </span>
                    <CopyButton
                      text={encodePairLink({
                        url: qrUrl || offer.urls[0]!.url,
                        code: offer.code,
                        expiresAt: offer.expiresAt,
                      })}
                      label={t('Copy pairing link')}
                    />
                  </div>
                )}
                {qr && !expired && (
                  <div className="flex flex-col items-center gap-2">
                    <img src={qr} width={240} height={240} alt="Scan this pairing offer with Ramu on your phone" />
                    <Dropdown
                      label={t('QR host address')}
                      value={qrUrl || offer.urls[0]!.url}
                      options={offer.urls.map((entry) => ({ value: entry.url, label: entry.url }))}
                      onChange={setQrUrl}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="muted text-muted-foreground small text-caption">{t('Addresses this host has')}</span>
                  {urls.length ? (
                    urls.map((entry) => (
                      <div
                        key={entry.url}
                        className="flex items-center gap-2 rounded-(--radius-s) bg-fill p-[4px_6px_4px_12px]"
                      >
                        <code className="font-mono text-control grow flex-1 min-w-0 truncate">{entry.url}</code>
                        <span className="muted text-muted-foreground small text-caption flex-none">
                          {entry.interface}
                        </span>
                        <CopyButton text={entry.url} label={t('Copy address')} />
                      </div>
                    ))
                  ) : (
                    <p className="muted text-muted-foreground small text-caption">
                      {t('No network address found. Connect this host to a network or VPN.')}
                    </p>
                  )}
                  {hidden > 0 && (
                    <Button variant="ghost" className="self-start" onClick={() => setShowOther(true)}>
                      {t('Show {0} more (Docker, VM and other virtual networks)', { 0: other.length })}
                    </Button>
                  )}
                </div>
              </>
            )
          )}
        </DialogScrollBody>
        <DialogFooter>
          <Button
            variant={joined ? 'default' : 'secondary'}
            className={joined ? undefined : 'bg-fill hover:bg-fill-hover'}
            onClick={onClose}
          >
            {joined ? t('Done') : t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What each connected host runs on, read from its own status; a host not reachable keeps the last answer. */
function useHostOs(computers: Computer[]): Record<string, DeviceOs | undefined> {
  const [known, setKnown] = useState<Record<string, DeviceOs | undefined>>({})
  const reachable = computers.filter((computer) => computer.local || computer.status === 'connected')
  const key = reachable.map((computer) => computer.id).join(',')
  useEffect(() => {
    for (const computer of reachable)
      void invokeUncachedOn(computer.id, 'background.status').then(
        (status) => status.os && setKnown((current) => ({ ...current, [computer.id]: status.os })),
        () => {},
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the reachable hosts
  }, [key])
  return known
}

/** A part of Remote access: a title a person scans for, what it is for, and its main actions. */
function Section({
  title,
  help,
  actions,
  children,
}: {
  title: string
  help?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mb-8" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="m-0 text-body font-semibold">{title}</h4>
          {help && <p className="m-[2px_0_0] text-caption text-muted-foreground">{help}</p>}
        </div>
        {actions && <div className="flex flex-none items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Computers({ state }: { state: ComputerList }) {
  const hostOs = useHostOs(state.computers)
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<{ link?: string; repair?: Computer } | null>(null),
    [editing, setEditing] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [inviting, setInviting] = useState<Computer | null>(null)
  const others = state.computers.filter((computer) => !computer.local)
  const [agentHosts, setAgentHosts] = useState<AgentHostSummary[] | null>(null)
  const [everywhere, setEverywhere] = useState({ on: false, seq: 0 })
  const refreshAgentHosts = useCallback(
    () => invoke('network.agentHosts').then(setAgentHosts, () => setAgentHosts([])),
    [],
  )
  useEffect(() => {
    void refreshAgentHosts()
  }, [refreshAgentHosts])
  const agents = { hosts: agentHosts, refresh: refreshAgentHosts, everywhere }
  const reachable = agentReachable(state.computers)
  const selected = state.computers.find((computer) => computer.id === editing)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (error) {
      notifyError(errorText(error), t('Hosts'))
    } finally {
      setBusy(false)
    }
  }
  // A pairing link opened from outside the app arrives while this screen is showing, or just before it does.
  useEffect(() => {
    const show = () => {
      const incoming = takePairLink()
      if (incoming) setAdding({ link: incoming })
    }
    show()
    return onPairLink(show)
  }, [])
  const connected = state.computers.filter((computer) => computer.status === 'connected').length
  return (
    <Section
      title={t('Hosts you use')}
      help={
        others.length
          ? t('{0} connected · {1} saved', { 0: connected, 1: state.computers.length })
          : t('Add your laptop, workstation or server. They stay connected together while Ramu is open.')
      }
      actions={
        <>
          <UpdateAllHosts computers={state.computers} />
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAdding({})}>
            <Plus size={14} />
            {t('Add a host')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {state.computers.map((computer) => (
          <article
            key={computer.id}
            className={`computer-card rounded-(--radius-m) px-3 py-2.5 ${computer.id === state.current ? 'bg-primary/10' : 'bg-fill'}`}
            aria-label={computer.name}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-s) bg-hover text-muted-foreground">
                <DeviceIcon os={hostOs[computer.id]} name={computer.name} />
              </span>
              <div className="min-w-0 grow">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-body font-medium">{computer.name}</strong>
                  {!computer.local && (
                    <span className="flex-none text-caption text-muted-foreground">
                      {computer.ssh ? t('SSH') : t('Remote')}
                    </span>
                  )}
                  {computer.id === state.current && (
                    <span className="flex-none rounded-full bg-primary/10 px-2 py-0.5 text-caption text-(--accent)">
                      {t('Showing')}
                    </span>
                  )}
                </div>
                <p
                  className="m-0 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
                  title={computer.ssh ? `ssh ${computer.ssh}` : (computer.url ?? state.deviceName)}
                >
                  <StatusDot status={computer.status} />
                  <span className="truncate">
                    {[
                      activityText(computer) || statusText(computer.status),
                      hostRoute(computer),
                      osLine(hostOs[computer.id]),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </p>
              </div>
              <div className="flex flex-none items-center gap-1">
                {computer.id !== state.current && (computer.local || computer.status === 'connected') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.open', computer.id))}
                  >
                    {t('Open')}
                  </Button>
                )}
                {!computer.local && computer.status === 'offline' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.retry', computer.id))}
                  >
                    {t('Retry')}
                  </Button>
                )}
                {!computer.local && computer.status === 'paused' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.update', computer.id, { enabled: true }))}
                  >
                    {t('Resume')}
                  </Button>
                )}
                {!computer.local && computer.status === 'rejected' && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAdding({ repair: computer })}>
                    {t('Pair again')}
                  </Button>
                )}
                {!computer.local && (
                  <Menu
                    label={t('More for {0}', { 0: computer.name })}
                    icon={<MoreHorizontal size={15} />}
                    align="end"
                    disabled={busy}
                    items={[
                      { key: 'settings', label: t('Connection settings…'), onSelect: () => setEditing(computer.id) },
                      ...(computer.status === 'connected'
                        ? [
                            {
                              key: 'invite',
                              label: t('Let {0} connect here…', { 0: computer.name }),
                              onSelect: () => setInviting(computer),
                            },
                          ]
                        : []),
                      ...(computer.status === 'paused' || computer.status === 'rejected'
                        ? []
                        : [
                            {
                              key: 'pause',
                              label: t('Pause connection'),
                              onSelect: () =>
                                void act(() => invoke('computers.update', computer.id, { enabled: false })),
                            },
                          ]),
                      { key: 'gap', separator: true as const },
                      { key: 'forget', label: t('Forget…'), danger: true, onSelect: () => setForgetting(computer.id) },
                    ]}
                  />
                )}
              </div>
            </div>
            {/* Under the name: Ramu's version and updates, then what this device may do there, set apart by a rule. */}
            <div className="ml-[44px] flex flex-col gap-1 empty:hidden">
              <HostUpdateLine computer={computer} />
              {computer.grantedUnreachable && (
                <p role="status" className="m-[6px_0_0] text-caption text-muted-foreground">
                  {t(
                    'Paired, but this host has not answered yet. Ramu keeps the access and connects when it is reachable; you do not need the code again.',
                  )}
                </p>
              )}
              {!computer.local && computer.status === 'connected' && (
                <div className="mt-1.5 flex flex-col gap-1 border-t border-border pt-1.5 empty:hidden">
                  <HostAccess computer={computer} agents={agents} />
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {reachable.length > 1 && (
        <div className="mt-2">
          <SettingsRow className="settings-toggle">
            <SettingsLabel
              title={t('Agents on all hosts')}
              help={t(
                'Let agents here start threads on every connected host. A host that has not allowed it is asked.',
              )}
            />
            <Switch
              aria-label={t('Agents on all hosts')}
              checked={agentsOnEverywhere(reachable, agentHosts ?? [])}
              disabled={!agentHosts}
              onCheckedChange={(on) => setEverywhere((current) => ({ on, seq: current.seq + 1 }))}
            />
          </SettingsRow>
        </div>
      )}
      {adding && <AddHostDialog {...adding} onClose={() => setAdding(null)} />}
      {inviting && (
        <InviteBackDialog
          computer={inviting}
          from={state.computers.find((computer) => computer.local)?.name ?? state.deviceName}
          onClose={() => setInviting(null)}
        />
      )}
      {selected && <ComputerSettings key={selected.id} computer={selected} onClose={() => setEditing(null)} />}
      {forgetting !== null && (
        <ConfirmDialog
          danger
          title={t('Forget {0}?', { 0: others.find((computer) => computer.id === forgetting)?.name ?? '' })}
          confirmLabel={t('Forget')}
          onCancel={() => setForgetting(null)}
          onConfirm={() => {
            const id = forgetting
            setForgetting(null)
            if (id) void act(() => invoke('computers.forget', id))
          }}
        >
          <p>
            {forgetting === state.current
              ? t('You are looking at it now, so Ramu goes back to this host. You can pair again later.')
              : t('You can pair again later. The other host still lists this device until you revoke it there.')}
          </p>
        </ConfirmDialog>
      )}
    </Section>
  )
}

/**
 * Invites a host to connect back to this computer, so each can open the other. This computer makes a full-access code
 * and hands it to that host, whose owner connects with one tap; nobody types it, and nothing connects until they do.
 */
function InviteBackDialog({ computer, from, onClose }: { computer: Computer; from: string; onClose: () => void }) {
  useLanguage()
  const own = ownHostId()
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const owner = useRef(crypto.randomUUID()).current
  useEffect(() => {
    void invokeOn(own, 'network.status').then(
      (status) => setReachable(status.reachable),
      () => setReachable(false),
    )
  }, [own])
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const offer = await invokeOn(own, 'network.pair', 'owner', owner)
      if (!offer.urls.length) throw new Error(t('This computer has no address another host can reach yet.'))
      await invokeOn(computer.id, 'device.inviteBack', {
        name: from,
        urls: offer.urls.map((entry) => entry.url),
        code: offer.code,
        expiresAt: offer.expiresAt,
      })
      setSent(true)
    } catch (reason) {
      const message = errorText(reason)
      setError(/unknown method/i.test(message) ? t('Update Ramu on {0} to use this.', { 0: computer.name }) : message)
    } finally {
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {sent
              ? t('Invitation sent to {0}', { 0: computer.name })
              : t('Let {0} connect here?', { 0: computer.name })}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? t(
                  'Ramu asks on {0}. Once its owner connects, it appears under Devices that can use this host, where you can revoke it.',
                  { 0: computer.name },
                )
              : t(
                  '{0} will be able to open this computer’s threads, files and terminals, with full access. Ramu asks on {0} first; nothing connects until its owner accepts.',
                  { 0: computer.name },
                )}
          </DialogDescription>
        </DialogHeader>
        {reachable === false && !sent && (
          <p role="status" className="m-0 text-caption text-muted-foreground">
            {t('Turn on Ramu Link or Local network or VPN below first, so {0} can reach this computer.', {
              0: computer.name,
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant={sent ? 'default' : 'secondary'} disabled={busy} onClick={onClose}>
            {sent ? t('Done') : t('Cancel')}
          </Button>
          {!sent && (
            <Button variant="default" disabled={busy || !reachable} onClick={() => void send()}>
              {busy ? t('Sending…') : t('Send invitation')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type AddMode = 'account' | 'nearby' | 'address'

/**
 * Adding a host: Ramu Link hosts on the same account, hosts nearby, or one field that takes a pairing link, an address or
 * an SSH host and asks only for what that needs.
 */
function AddHostDialog({ link, repair, onClose }: { link?: string; repair?: Computer; onClose: () => void }) {
  useLanguage()
  const [mode, setMode] = useState<AddMode>(link || repair ? 'address' : 'account')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState(link ?? repair?.url ?? '')
  const [address, setAddress] = useState(repair?.url ?? ''),
    [code, setCode] = useState(''),
    [name, setName] = useState(repair?.name ?? '')
  const [focusCode, setFocusCode] = useState(!!repair)
  const [aliases, setAliases] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // Asking a host to pair: the number to match once it answers.
  const [asking, setAsking] = useState<{ name: string; code: string | null } | null>(null)
  useEffect(
    () => ramu.on('computers:pairCode', ({ code }) => setAsking((current) => current && { ...current, code })),
    [],
  )
  useEffect(() => {
    void invoke('computers.sshHosts').then(setAliases, () => {})
  }, [])
  const ssh = isSshTarget(text, aliases)
  // A pasted link or address fills the code and name; they stay editable.
  const read = (value: string) => {
    setText(value)
    setError(null)
    if (!value.trim() || isSshTarget(value, aliases)) return setAddress('')
    try {
      const parsed = parsePairInput(value)
      setAddress(parsed.url)
      if (parsed.code) setCode(parsed.code)
      if (parsed.name) setName((current) => current || parsed.name!)
    } catch (reason) {
      setAddress('')
      setError(errorText(reason))
    }
  }
  useEffect(() => {
    if (link) read(link)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the link the dialog opened with, once
  }, [])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const ask = (host: string, request: () => Promise<unknown>, fallback?: () => void) => {
    setAsking({ name: host, code: null })
    void request()
      .then(onClose)
      .catch((reason) => {
        setAsking(null)
        const message = errorText(reason)
        if (/cancelled|aborted/i.test(message)) return
        // Older hosts cannot be asked; they show a code to type instead.
        if (fallback) fallback()
        if (!fallback || !/needs a pairing code/i.test(message)) setError(message)
      })
  }
  const submit = () => {
    if (busy) return
    if (ssh) void run(() => invoke('computers.pairSsh', text.trim(), name.trim() || undefined))
    else if (address && code.trim())
      void run(() => invoke('computers.pair', address, code.trim(), name.trim() || undefined))
  }
  const tabs: { mode: AddMode; label: string; icon: ReactNode }[] = [
    { mode: 'account', label: t('Ramu Link'), icon: <RamuGlyph size={14} /> },
    { mode: 'nearby', label: t('Nearby'), icon: <Radar size={14} /> },
    { mode: 'address', label: t('Link, address or SSH'), icon: <Link2 size={14} /> },
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (asking) void Promise.resolve(invoke('computers.cancelPairRequest')).catch(() => {})
          onClose()
        }
      }}
    >
      <DialogContent className={`${DIALOG_SCROLLS} sm:max-w-[540px]`}>
        <DialogHeader>
          <DialogTitle>{repair ? t('Pair {0} again', { 0: repair.name }) : t('Add a host')}</DialogTitle>
          <DialogDescription>
            {t('Its projects, agents and terminals stay on that host. This computer opens and controls them.')}
          </DialogDescription>
        </DialogHeader>
        <DialogScrollBody>
          <div className="inline-flex gap-1 self-start rounded-(--radius-s) bg-fill p-0.5" role="group">
            {tabs.map((tab) => (
              <Button
                key={tab.mode}
                variant="ghost"
                size="sm"
                aria-pressed={mode === tab.mode}
                className={mode === tab.mode ? 'bg-hover text-foreground' : 'text-muted-foreground'}
                disabled={busy || !!asking}
                onClick={() => {
                  setMode(tab.mode)
                  setError(null)
                }}
              >
                {tab.icon}
                {tab.label}
              </Button>
            ))}
          </div>
          {asking ? (
            <div role="status" className="flex flex-col items-start gap-2 rounded-(--radius-m) bg-fill p-[14px_16px]">
              {asking.code ? (
                <>
                  <span className="text-control">
                    {t('Allow this computer on {0} if it shows this number', { 0: asking.name })}
                  </span>
                  <span className="font-mono text-[28px] font-semibold tracking-[0.12em]">{asking.code}</span>
                </>
              ) : (
                <span className="text-control">{t('Asking {0}…', { 0: asking.name })}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAsking(null)
                  void Promise.resolve(invoke('computers.cancelPairRequest')).catch(() => {})
                }}
              >
                {t('Cancel')}
              </Button>
            </div>
          ) : mode === 'account' ? (
            <AccountHosts
              onConnect={(host) =>
                ask(host.name, () => Promise.resolve(invoke('linkAccount.connect', host.hostId, host.name)))
              }
            />
          ) : mode === 'nearby' ? (
            <NearbyHosts
              onFallback={() => setMode('address')}
              onChoose={(host, url) =>
                ask(
                  host.name,
                  () => Promise.resolve(invoke('computers.pairByRequest', url, host.name)),
                  () => {
                    setMode('address')
                    setText(url)
                    setAddress(url)
                    setName((current) => current || host.name)
                    setCode('')
                    setFocusCode(true)
                  },
                )
              }
            />
          ) : (
            <form
              id="add-host"
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <Input
                aria-label={t('Link, address or SSH host')}
                placeholder={t('Pairing link, 100.64.0.7:7788 or user@host')}
                autoFocus={!focusCode}
                autoCapitalize="none"
                spellCheck={false}
                value={text}
                disabled={busy}
                aria-invalid={!!error && !ssh && !address}
                onChange={(event) => read(event.target.value)}
              />
              {aliases.length > 0 && (
                <Dropdown
                  label={t('SSH config aliases')}
                  value=""
                  placeholder={t('Choose from your SSH config')}
                  options={aliases.map((alias) => ({ value: alias, label: alias }))}
                  onChange={read}
                  disabled={busy}
                />
              )}
              <p className="m-0 text-caption text-muted-foreground">
                {ssh
                  ? t(
                      'Connects through SSH with your keys and ~/.ssh/config. Ramu must already be installed on that host; it is started there if it is not running, and no port is opened to the network.',
                    )
                  : t(
                      'On that host, open Remote access and choose Pair a device. Paste its link, or type its address and code.',
                    )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {!ssh && (
                  <Input
                    aria-label={t('Pairing code')}
                    placeholder={t('Pairing code')}
                    autoFocus={focusCode}
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(event.target.value)}
                  />
                )}
                <Input
                  aria-label={t('Name')}
                  placeholder={t('Name (optional)')}
                  maxLength={60}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </form>
          )}
          {error && (
            <p className="m-0 text-caption text-bad" role="alert">
              {error}
            </p>
          )}
        </DialogScrollBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          {mode === 'address' && !asking && (
            <Button
              type="submit"
              form="add-host"
              variant="default"
              disabled={busy || (ssh ? !text.trim() : !address || !code.trim())}
            >
              {busy ? (ssh ? t('Connecting…') : t('Pairing…')) : ssh ? t('Connect') : t('Pair')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ComputerSettings({ computer, onClose }: { computer: Computer; onClose: () => void }) {
  const [name, setName] = useState(computer.name),
    [enabled, setEnabled] = useState(computer.enabled !== false)
  const [retryMode, setRetryMode] = useState(computer.retryMode ?? 'events'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const routes = computer.url && !computer.ssh ? learnedRoutes([computer.url, ...(computer.routes ?? [])]) : []
  const switchNetwork = async (url: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('computers.reviewAddress', computer.id, url)
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
                {computer.url?.startsWith('https:') ? t('HTTPS connection') : t('HTTP · use a VPN or trusted network')}
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
                    {t(
                      'Both devices must be on the network you pick. Ramu checks it is the same host before switching.',
                    )}
                  </span>
                </span>
                <Dropdown
                  label={t('Network')}
                  value={computer.url ?? ''}
                  disabled={busy}
                  options={routes.map((route) => ({
                    value: route,
                    label: `${t(networkName(hostOfUrl(route)))} · ${hostOfUrl(route)}`,
                  }))}
                  onChange={(next) => void switchNetwork(next)}
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <span>
                <strong className="text-body font-medium">{t('Keep connected')}</strong>
                <span className="block mt-1 text-caption text-muted-foreground">
                  {t(
                    'Turn off to pause this connection without forgetting it. No retries or announcements are used while paused.',
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
                    'Waits for a network change, waking from sleep, a signed host announcement, or Retry. No periodic connection checks.',
                  )
                : t(
                    'Uses the same wake-up signals and a quiet five-minute check if an announcement cannot reach this device.',
                  )}
            </p>
            <p className="m-0 text-caption text-muted-foreground">
              {t(
                'Host announcements need a reachable LAN or VPN path. If your network blocks them, use Retry or enable five-minute checks.',
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
    </Dialog>
  )
}

/** The usual choices, plus the current value when it is something else (set from the command line). */
function lifetimeOptions(current: number | 'never', saved: boolean) {
  const days = [30, 90, 180, 365]
  const options = days.map((value) => ({ value: String(value), label: t('{0} days', { 0: value }) }))
  if (typeof current === 'number' && !days.includes(current))
    options.push({ value: String(current), label: t('{0} days', { 0: current }) })
  options.push({ value: 'never', label: t('Never expire') })
  if (saved) options.push({ value: 'default', label: t('Use the server default') })
  return options.sort(
    (a, b) =>
      Number(a.value === 'never' || a.value === 'default') - Number(b.value === 'never' || b.value === 'default') ||
      Number(a.value) - Number(b.value),
  )
}

/** What a paired device may do, in a few words for its collapsed row. */
function deviceSummary(device: NetworkDevice): string {
  return [osLine(device.os), accessSummary(device)].filter(Boolean).join(' · ')
}
function accessSummary(device: NetworkDevice): string {
  if (device.kind === 'host') return t('Another host’s agents: start and follow threads only')
  if (device.role === 'viewer') return t('Viewer')
  if (!device.permissions) return t('Full access')
  const allowed = DEVICE_PERMISSIONS.filter((permission) => device.permissions?.[permission]).length
  return t('Full access · {0} of {1} permissions', { 0: allowed, 1: DEVICE_PERMISSIONS.length })
}

/** How long one device stays paired without use: its own choice, or the same as every other device here. */
function DeviceExpiry({
  device,
  hostDays,
  invoke,
}: {
  device: NetworkDevice
  hostDays: number | 'never'
  invoke: Parameters<typeof DevicePermissionList>[0]['invoke']
}) {
  const current = device.lifetimeDays === undefined ? 'default' : String(device.lifetimeDays)
  const [value, stage] = useStagedValue<string>(`expiry:${device.id}`, current, (next) =>
    invoke('network.setDeviceExpiry', device.id, next === 'default' || next === 'never' ? next : Number(next)),
  )
  const sameAsOthers = hostDays === 'never' ? t('Never expire') : t('{0} days', { 0: hostDays })
  return (
    <div className={SETTINGS_CARD_LINE}>
      <SettingsLabel
        title={t('Keep paired')}
        help={t('Unused this long, it must pair again. Using it renews the time.')}
      />
      <Dropdown
        label={t('Keep {0} paired', { 0: device.name })}
        value={value}
        onChange={stage}
        options={[
          { value: 'default', label: t('Like other devices ({0})', { 0: sameAsOthers }) },
          ...lifetimeOptions(device.lifetimeDays ?? 90, false),
        ]}
      />
    </div>
  )
}

/**
 * One paired device as a single row: name, what it may do and when it was last seen. Its permissions, dates and Revoke
 * open below it, so a long list of devices stays scannable.
 */
function PairedDeviceRow({
  device,
  invoke,
  onRevoke,
  hostDays,
}: {
  device: NetworkDevice
  invoke: Parameters<typeof DevicePermissionList>[0]['invoke']
  onRevoke: () => void
  /** This host's default pairing lifetime, which a device follows unless it has its own. */
  hostDays: number | 'never'
}) {
  const [open, setOpen] = useState(false)
  const seen = device.lastSeenAt ? timeAgo(device.lastSeenAt) : t('never')
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SettingsRow className="settings-stack gap-0 p-1.5" />}>
      <CollapsibleTrigger
        render={
          <RowButton
            size="lg"
            className="rounded-(--radius-s) px-2.5 py-2.5"
            aria-label={t('{0}, {1}, last seen {2}', { 0: device.name, 1: deviceSummary(device), 2: seen })}
          />
        }
      >
        <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-s) bg-hover text-muted-foreground">
          <DeviceIcon os={device.os} name={device.name} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-control font-medium text-foreground">{device.name}</span>
          <span className="truncate text-caption text-muted-foreground">
            {`${deviceSummary(device)} · ${t('last seen {0}', { 0: seen })}`}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`flex-none text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-2.5 pt-2 pb-2.5">
        {device.kind === 'host' ? (
          <div className={SETTINGS_CARD_LINE}>
            <SettingsLabel
              title={t('Most access for its threads')}
              help={t('Threads this host’s agents start here never get more, whatever they ask for.')}
            />
            <HostCeiling deviceId={device.id} value={device.maxAccess ?? 'edits'} invoke={invoke} />
          </div>
        ) : (
          <DevicePermissionList device={device} invoke={invoke} />
        )}
        {device.kind !== 'host' && <DeviceExpiry device={device} hostDays={hostDays} invoke={invoke} />}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-caption text-muted-foreground">
            {`${device.expiresAt ? t('Expires {0}', { 0: new Date(device.expiresAt).toLocaleDateString() }) : t('Never expires')} · ${t('Paired {0}', { 0: new Date(device.createdAt).toLocaleDateString() })}`}
          </span>
          <Button variant="secondary" size="sm" className="bg-fill hover:bg-fill-hover" onClick={onRevoke}>
            {t('Revoke')}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
