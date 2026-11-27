import { useEffect, useState } from 'react'
import type { BackgroundStatus, NetworkStatus } from '@ramu/shared/types'
import { networkName, VIRTUAL_INTERFACE } from '@ramu/shared/networkLabel'
import { SettingsAdvanced, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl, SegmentedItem } from '@/components/choice-group'
import { Dialog as ConfirmDialog, Dropdown } from '../../Menu'
import { ramu } from '../../ipc'
import { errorText } from '../../lib/errors'
import { notifyError } from '../../chat/Notifications'
import { t } from '../../i18n'
import { KeepAwakeSettings } from '../KeepAwakeSettings'
import { OWN_RELAY_GUIDE, type RouteChoice } from '../RamuLinkState'
import { useSettingsEvents, useSettingsInvoke } from '../SettingsScope'
import { useStagedValue } from '../stagedChanges'
import type { DraftProps } from '../ToggleRow'
import { AccessSection } from './AccessSection'
import {
  ALL_NETWORKS,
  chooseReach,
  isLoopback,
  reachOf,
  REACHES,
  type ListenDraft,
  type Reach,
  STATUS_LINE,
  type TunnelDraft,
} from './reach'
import { StayReachableSwitch } from './StayReachableSwitch'
import { TunnelChoiceRows, tunnelName, TunnelStatus } from './TunnelSettings'
import { TriangleAlert } from 'lucide-react'

const DEFAULT_PORT = 7788
const validPort = (port: number) => Number.isInteger(port) && port >= 1024 && port <= 65535

const REACH_LABEL: Record<Reach, string> = {
  computer: 'This computer',
  network: 'This network',
  anywhere: 'Anywhere',
}

/**
 * Who can reach this host, as one choice: only this computer, devices on its network or VPN, or devices anywhere
 * through Ramu Link. The network, port, discoverability, other tunnels and staying up after a restart wait under
 * Advanced, already set for the choice.
 */
export function ReachableFrom({
  status,
  onStatus,
  draft,
  onChange,
  busy,
}: DraftProps & { status: NetworkStatus; onStatus: (status: NetworkStatus) => void }) {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const [confirm, setConfirm] = useState<Reach | null>(null)
  const [showRelay, setShowRelay] = useState(false)
  const [background, setBackground] = useState<BackgroundStatus | null>(null)
  const [awakeSupported, setAwakeSupported] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => {
    void invoke('background.status').then(setBackground, () => {})
    void invoke('background.keepAwake').then(
      (state) => setAwakeSupported(state.supported),
      () => {},
    )
  }, [invoke])
  useEffect(() => {
    const read = () =>
      void invoke('account.status').then(
        (account) => setSignedIn(account.signedIn),
        () => setSignedIn(null),
      )
    read()
    return on('account:changed', read)
  }, [invoke, on])
  const fail = (error: unknown) => notifyError(errorText(error), t('Devices & access'))
  const [listen, stageListen] = useStagedValue<ListenDraft>(
    'network.config',
    {
      enabled: status.enabled,
      host: status.host || ALL_NETWORKS,
      port: String(status.port || DEFAULT_PORT),
      discoverable: status.discovery?.discoverable,
    },
    async ({ port: chosen, discoverable, ...rest }) => {
      if (!validPort(Number(chosen))) throw new Error(t('Use a number from 1024 to 65535.'))
      try {
        onStatus(
          await invoke('network.configure', {
            ...rest,
            port: Number(chosen),
            acceptUnencrypted: true,
            // Left out, the host keeps its saved choice.
            ...(discoverable === undefined ? {} : { discoverable }),
          }),
        )
      } catch (error) {
        fail(error)
      }
    },
  )
  const saved = status.tunnel?.choice ?? null
  const [tunnel, stageTunnel] = useStagedValue<TunnelDraft>(
    'network.reach',
    {
      mode: saved?.kind ?? (status.publicAddress?.url ? 'manual' : 'off'),
      domain: saved?.domain ?? '',
      relay: saved?.relay ?? '',
      url: saved ? '' : (status.publicAddress?.url ?? ''),
    },
    async ({ mode, domain, relay, url }) => {
      try {
        if (mode === 'link' || mode === 'quick' || mode === 'tailscale' || mode === 'ngrok')
          onStatus(
            await invoke('network.setTunnel', {
              kind: mode,
              ...(mode === 'ngrok' && domain.trim() ? { domain: domain.trim() } : {}),
              ...(mode === 'link' && relay.trim() ? { relay: relay.trim() } : {}),
            }),
          )
        else {
          if (saved) await invoke('network.setTunnel', null)
          onStatus(await invoke('network.setPublicUrl', mode === 'manual' ? url.trim() || null : null))
        }
      } catch (error) {
        fail(error)
      }
    },
  )
  const canStay = !!background?.loginSupported && background.keepRunning !== undefined
  const [stay, stageStay] = useStagedValue('background.stayReachable', !!background?.loginEnabled, async (next) => {
    // Starting at login needs the service to outlive the app.
    if (next && !background?.keepRunning) await invoke('background.keepRunning', true)
    await invoke('background.login', next)
    setBackground(await invoke('background.status'))
  })
  const managed = status.source === 'command-line'
  const tunnelFixed = managed || status.publicAddress?.source === 'command-line'
  const reach = reachOf(listen, tunnel)
  const portValid = validPort(Number(listen.port))
  const apply = (next: Reach) => {
    const chosen = chooseReach(next, listen, tunnel, !!status.tunnel)
    stageListen(chosen.listen)
    stageTunnel(chosen.tunnel)
    // Opening the host is when it has to stay up for the devices that use it; the switches under Advanced undo it.
    if (reach !== 'computer' || next === 'computer') return
    if (canStay && !background?.loginEnabled) stageStay(true)
    if (awakeSupported && !draft.keepAwake) onChange({ ...draft, keepAwake: true })
  }
  const choose = (next: Reach) => {
    if (next === reach) return
    if (reach === 'computer' && !status.tls) setConfirm(next)
    else apply(next)
  }
  const chooseRoute = (route: RouteChoice) => {
    if (route === 'own-relay') {
      setShowRelay(true)
      void ramu.invoke('app.openExternal', OWN_RELAY_GUIDE).catch(() => {})
      return
    }
    stageTunnel({ ...tunnel, mode: route })
  }
  const networks = [
    { value: ALL_NETWORKS, label: t('All networks') },
    ...status.addresses
      .filter(
        (entry) =>
          entry.address === listen.host || (!VIRTUAL_INTERFACE.test(entry.name) && !entry.address.includes(':')),
      )
      .map((entry) => ({
        value: entry.address,
        label: `${t(networkName(entry.address, entry.name))} · ${entry.name} · ${entry.address}`,
      })),
  ]
  if (!networks.some((option) => option.value === listen.host))
    networks.push({ value: listen.host, label: listen.host })
  const listening = status.listening ? `${status.host}:${status.port}` : null
  const route = tunnel.mode === 'manual' ? t('your own tunnel') : tunnelName(tunnel.mode)
  const help = managed
    ? t('Set when Ramu was started with --listen. Change it there.')
    : reach === 'computer'
      ? t(
          'Only this computer uses this host. Choose This network or Anywhere to let your paired phones and computers in.',
        )
      : reach === 'network'
        ? t('Paired phones and computers connect on your network or VPN.')
        : isLoopback(listen.host)
          ? t('Paired devices connect from anywhere through {0}.', { 0: route })
          : t('Paired devices connect on your network, and from anywhere through {0}.', { 0: route })
  return (
    <AccessSection
      title={t('Reachable from')}
      help={help}
      actions={
        <SegmentedControl
          size="sm"
          aria-label={t('Reachable from')}
          value={[reach]}
          disabled={managed || busy}
          onValueChange={(values) => {
            const next = REACHES.find((entry) => entry === values[0])
            if (next) choose(next)
          }}
        >
          {REACHES.map((entry) => (
            <SegmentedItem
              key={entry}
              value={entry}
              className="px-2.5"
              disabled={entry === 'anywhere' && !status.publicAddress}
            >
              {t(REACH_LABEL[entry])}
            </SegmentedItem>
          ))}
        </SegmentedControl>
      }
    >
      {/* What the connection is doing now, as one card of rows rather than loose lines between the controls. */}
      {(status.enabled || (reach === 'anywhere' && status.publicAddress)) && (
        <div className="mb-3 flex flex-col divide-y divide-(--line) overflow-hidden rounded-(--radius-m) bg-fill">
          {status.enabled && (
            <p className={STATUS_LINE} role="status">
              {listening
                ? t('Listening on {0}', { 0: listening })
                : status.error
                  ? t('Cannot listen on {0}:{1} ({2}). Local use still works, and Ramu keeps retrying.', {
                      0: status.host,
                      1: status.port,
                      2: status.error,
                    })
                  : t('Starting…')}
            </p>
          )}
          {!status.tls && status.enabled && !isLoopback(status.host) && (
            <p className={`${STATUS_LINE} text-warn`}>
              <TriangleAlert size={13} className="flex-none" aria-hidden />
              {t('Ramu does not encrypt this connection. Use it on a VPN or a network you trust.')}
            </p>
          )}
          {reach === 'anywhere' && status.publicAddress && (
            <TunnelStatus
              status={status}
              tunnel={tunnel}
              saved={saved}
              signedIn={signedIn}
              onChoose={chooseRoute}
              onRelease={() => void invoke('network.releaseLink').then(onStatus).catch(fail)}
              onReleaseOther={(hostId) => invoke('network.releaseOtherLink', hostId).then(onStatus).catch(fail)}
            />
          )}
        </div>
      )}
      <SettingsAdvanced className="mt-0">
        {!managed && listen.enabled && (
          <SettingsRow>
            <SettingsLabel
              title={t('Network')}
              help={t(
                'Nearby devices or devices on your VPN connect on this network. Choose your VPN to keep Ramu off other networks.',
              )}
            />
            <Dropdown
              label={t('Network')}
              value={listen.host}
              options={networks}
              onChange={(next) => stageListen({ ...listen, host: next })}
            />
          </SettingsRow>
        )}
        {status.discovery && (
          <SettingsRow className="settings-toggle">
            <SettingsLabel
              title={t('Discoverable on this network')}
              help={
                managed
                  ? t('Set with --discoverable when Ramu was started with --listen.')
                  : t(
                      'Devices on the same network see this host as {0} and can ask to pair. Seeing it gives no access. Off by default.',
                      { 0: status.discovery.name },
                    )
              }
            />
            <Switch
              aria-label={t('Discoverable on this network')}
              checked={!!listen.discoverable}
              disabled={managed}
              onCheckedChange={(checked) => stageListen({ ...listen, discoverable: checked })}
            />
          </SettingsRow>
        )}
        {status.enabled && status.discovery?.discoverable && (
          <p className="muted text-muted-foreground small text-caption m-[0_0_12px]" role="status">
            {status.discovery.state === 'advertising'
              ? t('Visible as {0} on {1}', { 0: status.discovery.name, 1: status.discovery.interfaces.join(', ') })
              : status.listening
                ? t('Not visible right now ({0}). Pairing by address or QR code still works.', {
                    0: status.discovery.error ?? t('no network to advertise on'),
                  })
                : t('Starting…')}
          </p>
        )}
        {!managed && (
          <SettingsRow>
            <SettingsLabel title={t('Port')} help={portValid ? undefined : t('Use a number from 1024 to 65535.')} />
            <Input
              aria-label={t('Port')}
              inputMode="numeric"
              value={listen.port}
              aria-invalid={!portValid}
              onChange={(event) => stageListen({ ...listen, port: event.target.value.replace(/\D/g, '').slice(0, 5) })}
            />
          </SettingsRow>
        )}
        {status.publicAddress && (
          <TunnelChoiceRows
            status={status}
            tunnel={tunnel}
            saved={saved}
            fixed={tunnelFixed}
            showRelay={showRelay}
            onChange={stageTunnel}
          />
        )}
        {canStay && !managed && (
          <StayReachableSwitch checked={stay} keepRunning={!!background?.keepRunning} onChange={stageStay} />
        )}
        <KeepAwakeSettings draft={draft} onChange={onChange} busy={busy} supported={awakeSupported} />
      </SettingsAdvanced>
      {confirm && (
        <ConfirmDialog
          title={t('Let other devices reach this host?')}
          confirmLabel={t('Turn on')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            apply(confirm)
            setConfirm(null)
          }}
        >
          <p>
            {t(
              'Ramu does not encrypt this connection. Anyone on that network could read what a paired device sends. Turn it on only for a VPN such as Tailscale, NetBird or ZeroTier, or a network you trust. Devices still need a pairing code.',
            )}
          </p>
        </ConfirmDialog>
      )}
    </AccessSection>
  )
}
