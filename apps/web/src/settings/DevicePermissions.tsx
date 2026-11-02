import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import {
  AUTOMATIC_PERMISSIONS,
  DEVICE_PERMISSIONS,
  DURATION_LABEL,
  PERMISSION_DURATIONS,
  PERMISSION_HELP,
  PERMISSION_LABEL,
  grantActive,
  mayUse,
  type DevicePermission,
  type PermissionDuration,
  type DevicePermissionsView,
  type PermissionGrant,
} from '@ramu/shared/devicePermissions'
import type { AgentHostSummary, Computer, NetworkDevice, NetworkStatus } from '@ramu/shared/types'
import { useCallback, useEffect, useState } from 'react'
import { Dropdown } from '../Menu'
import { SETTINGS_CARD_LINE } from './cards'
import { invoke, invokeOn } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { errorText } from '../lib/errors'
import { notifyError } from '../chat/Notifications'
import { sameAddress } from './agentHostLinks'
import { t } from '../i18n'

/** Runs one host-only permission change and shows the host's updated status. */
export type PermissionInvoke = (
  method:
    | 'network.setDevicePermission'
    | 'network.decidePermission'
    | 'network.setDefaultPermissions'
    | 'network.setHostAccess',
  ...args: unknown[]
) => Promise<void>

/** How long a grant lasts, in a few words. */
export function grantText(grant: PermissionGrant | null | undefined): string {
  if (!grant || !grantActive(grant, Date.now())) return t('Off')
  if (grant.session) return t('This time')
  if (grant.until === null) return t('Always')
  return t('Until {0}', {
    0: new Date(grant.until).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
  })
}

/** Devices asking for a permission: allow it this time, for a while or always, or deny. */
export function PermissionRequests({ status, invoke }: { status: NetworkStatus; invoke: PermissionInvoke }) {
  if (!status.permissionRequests?.length) return null
  return (
    <>
      {status.permissionRequests.map((request) => (
        <div
          key={request.id}
          role="alert"
          className="mb-3 flex flex-col gap-2 rounded-(--radius-m) border border-(--line) bg-fill p-[14px_16px]"
        >
          <strong className="text-control">
            {t('{0} asks for {1}', { 0: request.deviceName, 1: t(PERMISSION_LABEL[request.permission]) })}
          </strong>
          <span className="text-caption text-muted-foreground">{t(PERMISSION_HELP[request.permission])}</span>
          <div className="flex flex-wrap gap-2">
            {PERMISSION_DURATIONS.map((duration) => (
              <Button
                key={duration}
                size="sm"
                variant={duration === 'once' ? 'default' : 'secondary'}
                onClick={() => void invoke('network.decidePermission', request.id, duration)}
              >
                {t(DURATION_LABEL[duration])}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void invoke('network.decidePermission', request.id, 'deny')}
            >
              {t('Deny')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void invoke('network.decidePermission', request.id, 'never')}
            >
              {t('Never')}
            </Button>
          </div>
        </div>
      ))}
    </>
  )
}

/** What a full-access device gets when it pairs. */
export function DefaultPermissions({ status, invoke }: { status: NetworkStatus; invoke: PermissionInvoke }) {
  if (!status.defaultPermissions) return null
  const current = status.defaultPermissions
  return (
    <>
      {AUTOMATIC_PERMISSIONS.map((permission) => (
        <SettingsRow key={permission} className="settings-toggle">
          <SettingsLabel
            title={t('New devices: {0}', { 0: t(PERMISSION_LABEL[permission]) })}
            help={t(PERMISSION_HELP[permission])}
          />
          <Switch
            aria-label={t('New devices: {0}', { 0: t(PERMISSION_LABEL[permission]) })}
            checked={current.includes(permission)}
            onCheckedChange={(checked) =>
              void invoke(
                'network.setDefaultPermissions',
                checked ? [...current, permission] : current.filter((entry) => entry !== permission),
              )
            }
          />
        </SettingsRow>
      ))}
    </>
  )
}

/** One paired device's permissions, each changeable: off, this time, for a while or always. */
export function DevicePermissionList({ device, invoke }: { device: NetworkDevice; invoke: PermissionInvoke }) {
  if (device.role === 'viewer') return null
  const held = (permission: DevicePermission): PermissionGrant | null =>
    device.permissions ? (device.permissions[permission] ?? null) : { until: null }
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1.5">
      {DEVICE_PERMISSIONS.map((permission) => {
        const grant = held(permission)
        const state = device.blocked?.includes(permission) ? t('Never') : grantText(grant)
        return (
          <div key={permission} className={SETTINGS_CARD_LINE}>
            <span className="min-w-0 flex-1 truncate text-control">{t(PERMISSION_LABEL[permission])}</span>
            <Dropdown
              label={`${t(PERMISSION_LABEL[permission])}: ${state}`}
              value=""
              placeholder={state}
              options={[
                ...PERMISSION_DURATIONS.map((duration) => ({ value: duration, label: t(DURATION_LABEL[duration]) })),
                { value: 'revoke', label: t('Off') },
                { value: 'never', label: t('Never (no more requests)') },
              ]}
              onChange={(value) =>
                void invoke(
                  'network.setDevicePermission',
                  device.id,
                  permission,
                  value as PermissionDuration | 'revoke' | 'never',
                )
              }
            />
          </div>
        )
      })}
      {device.agentHost && (
        <div className={SETTINGS_CARD_LINE}>
          <span className="min-w-0 flex-1 truncate text-control">{t('Most access for its threads')}</span>
          <HostCeiling deviceId={device.agentHost.id} value={device.agentHost.maxAccess} invoke={invoke} />
        </div>
      )}
    </div>
  )
}

/** The most access threads get from a host pairing, set on the host they run on. */
export function HostCeiling({
  deviceId,
  value,
  invoke,
}: {
  deviceId: string
  value: 'edits' | 'auto' | 'full'
  invoke: PermissionInvoke
}) {
  return (
    <Dropdown
      label={t('Most access for its threads')}
      value={value}
      options={[
        { value: 'edits', label: t('Allow edits') },
        { value: 'auto', label: t('Auto') },
        { value: 'full', label: t('Full access') },
      ]}
      onChange={(next) => void invoke('network.setHostAccess', deviceId, next)}
    />
  )
}

/**
 * Agents on this computer using that host. The host grants the permission; this computer then pairs its own server with
 * a code the grant allows, so no code passes through a person. Asking and being granted connects without a second step.
 */
function AgentsPermission({
  computer,
  held,
  asked,
  declined,
  onRequest,
}: {
  computer: Computer & { url: string }
  held: boolean
  asked: boolean
  declined: boolean
  onRequest: () => void
}) {
  const [hosts, setHosts] = useState<AgentHostSummary[] | null>(null)
  const [wanted, setWanted] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void invoke('network.agentHosts').then(setHosts, () => setHosts([]))
  }, [])
  const linked = hosts?.find((host) => sameAddress(host.address, computer.url))
  const run = async (action: () => Promise<AgentHostSummary[]>) => {
    setBusy(true)
    try {
      setHosts(await action())
    } catch (reason) {
      notifyError(errorText(reason), t('Agents'))
    } finally {
      setBusy(false)
    }
  }
  const connect = () =>
    run(async () => {
      const { code } = await invokeOn(computer.id, 'device.agentPairing')
      return invoke('network.addAgentHost', computer.url, code, computer.name)
    })
  useEffect(() => {
    if (!wanted || !held || !hosts) return
    setWanted(false)
    if (!linked) void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the grant arrives; `connect` reads the current render
  }, [wanted, held, hosts])
  const state = declined ? t('Declined by the host') : !held ? t('Off') : linked ? t('On') : t('Allowed')
  return (
    <div className={SETTINGS_CARD_LINE}>
      <span className="min-w-0 flex-1 truncate text-control">{t(PERMISSION_LABEL.agents)}</span>
      <span className="flex-none text-caption text-muted-foreground">{state}</span>
      {held ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !hosts}
          onClick={() => void (linked ? run(() => invoke('network.forgetAgentHost', linked.id)) : connect())}
        >
          {linked ? t('Turn off') : t('Turn on')}
        </Button>
      ) : (
        !declined && (
          <Button
            size="sm"
            variant="secondary"
            disabled={asked}
            onClick={() => {
              setWanted(true)
              onRequest()
            }}
          >
            {asked ? t('Asked') : t('Request')}
          </Button>
        )
      )}
    </div>
  )
}

/** What this computer may do on another host, with a request for anything missing. The other host decides. */
export function ThisDevicePermissions({ computer }: { computer: Computer }) {
  const host = computer.id
  const [view, setView] = useState<DevicePermissionsView | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(
    () =>
      invokeOn(host, 'device.permissions').then(setView, (reason) => {
        setView(null)
        setError(errorText(reason))
      }),
    [host],
  )
  useEffect(() => {
    void load()
  }, [load])
  // That host's answer arrives there, so follow it while a request is open.
  const waiting = !!view?.pending.length
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
  }, [waiting, load])
  if (!view) return error ? <p className="m-0 text-caption text-muted-foreground">{error}</p> : null
  const request = (permission: DevicePermission) =>
    void invokeOn(host, 'device.requestPermission', permission).then(load, (reason) => setError(errorText(reason)))
  const url = computer.url
  return (
    <div className="mt-3 flex flex-col gap-0.5 border-t border-border pt-2">
      {DEVICE_PERMISSIONS.map((permission) => {
        // An older host has no such permission; an SSH address is a tunnel only this window can reach.
        if (permission === 'agents') {
          if (!(permission in view.permissions) || computer.ssh || !url) return null
          return (
            <AgentsPermission
              key={permission}
              computer={{ ...computer, url }}
              held={!!view.permissions.agents}
              asked={view.pending.includes('agents')}
              declined={!view.permissions.agents && !!view.blocked?.includes('agents')}
              onRequest={() => request('agents')}
            />
          )
        }
        const grant = view.permissions[permission]
        const asked = view.pending.includes(permission)
        const declined = !grant && !!view.blocked?.includes(permission)
        return (
          <div key={permission} className={SETTINGS_CARD_LINE}>
            <span className="min-w-0 flex-1 truncate text-control">{t(PERMISSION_LABEL[permission])}</span>
            <span className="flex-none text-caption text-muted-foreground">
              {declined ? t('Declined by the host') : grantText(grant)}
            </span>
            {!grant && !declined && (
              <Button size="sm" variant="secondary" disabled={asked} onClick={() => request(permission)}>
                {asked ? t('Asked') : t('Request')}
              </Button>
            )}
          </div>
        )
      })}
      {error && <p className="m-0 text-caption text-bad">{error}</p>}
    </div>
  )
}

/** Shown where a host refused for a missing permission: one tap asks the person at that host for it. */
export function PermissionNeeded({ host, permission }: { host: string; permission: DevicePermission | null }) {
  const [asked, setAsked] = useState<DevicePermission | null>(null)
  if (!permission) return null
  return (
    <span className="flex flex-wrap items-center gap-2 text-caption">
      {t('This device needs {0} on this host.', { 0: t(PERMISSION_LABEL[permission]) })}
      <Button
        size="sm"
        variant="secondary"
        disabled={asked === permission}
        onClick={() =>
          void invokeOn(host, 'device.requestPermission', permission).then(
            () => setAsked(permission),
            () => setAsked(permission),
          )
        }
      >
        {asked === permission ? t('Asked · allow it on the host') : t('Request access')}
      </Button>
    </span>
  )
}

/**
 * Whether this computer should be offered a control that needs `permission` on the host it is viewing. The host this
 * window runs on grants everything; another host is read and followed as it decides, and an unknown answer offers the
 * control so the host's own refusal still explains.
 */
export function useMayUse(permission: DevicePermission): boolean {
  const host = useHost()
  const { on } = useHostRuntime()
  const [view, setView] = useState<DevicePermissionsView | null>(null)
  const { isLocal, id } = host
  useEffect(() => {
    setView(null)
    if (isLocal) return
    let disposed = false
    const load = () =>
      invokeOn(id, 'device.permissions').then(
        (next) => !disposed && setView(next),
        () => !disposed && setView(null),
      )
    void load()
    const off = on('device:permissions', () => void load())
    return () => {
      disposed = true
      off()
    }
  }, [id, isLocal, on])
  return isLocal || mayUse(view, permission, Date.now())
}
