import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import {
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
import { useStagedValue } from './stagedChanges'
import { t } from '../i18n'

/** Runs one host-only permission change and shows the host's updated status. */
export type PermissionInvoke = (
  method:
    | 'network.setDevicePermission'
    | 'network.decidePermission'
    | 'network.setDefaultPermissions'
    | 'network.setHostAccess'
    | 'network.setDeviceExpiry',
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
  const saved = status.defaultPermissions ?? []
  const [current, stageCurrent] = useStagedValue('network.defaultPermissions', saved, (value) =>
    invoke('network.setDefaultPermissions', value),
  )
  if (!status.defaultPermissions) return null
  return (
    <>
      {DEVICE_PERMISSIONS.map((permission) => (
        <SettingsRow key={permission} className="settings-toggle">
          <SettingsLabel
            title={t('New devices: {0}', { 0: t(PERMISSION_LABEL[permission]) })}
            help={t(PERMISSION_HELP[permission])}
          />
          <Switch
            aria-label={t('New devices: {0}', { 0: t(PERMISSION_LABEL[permission]) })}
            checked={current.includes(permission)}
            onCheckedChange={(checked) =>
              stageCurrent(
                // Saved order, so turning one off and on again is no change.
                DEVICE_PERMISSIONS.filter((entry) => (entry === permission ? checked : current.includes(entry))),
              )
            }
          />
        </SettingsRow>
      ))}
    </>
  )
}

const PERMISSION_CHOICES = () => [
  ...PERMISSION_DURATIONS.map((duration) => ({ value: duration as string, label: t(DURATION_LABEL[duration]) })),
  { value: 'revoke', label: t('Off') },
  { value: 'never', label: t('Never (no more requests)') },
]

function PermissionLine({
  device,
  permission,
  invoke,
}: {
  device: NetworkDevice
  permission: DevicePermission
  invoke: PermissionInvoke
}) {
  const grant = device.permissions ? (device.permissions[permission] ?? null) : { until: null }
  const state = device.blocked?.includes(permission) ? t('Never') : grantText(grant)
  // A choice has no saved value of its own: the grant it makes is what is stored, and it may be time-limited.
  const [choice, choose] = useStagedValue(`permission:${device.id}:${permission}`, '', (value) =>
    invoke('network.setDevicePermission', device.id, permission, value as PermissionDuration | 'revoke' | 'never'),
  )
  const label = t(PERMISSION_LABEL[permission])
  return (
    <div className={SETTINGS_CARD_LINE}>
      <span className="min-w-0 flex-1 truncate text-control">{label}</span>
      <Dropdown
        label={`${label}: ${state}`}
        value={choice}
        placeholder={state}
        options={PERMISSION_CHOICES()}
        onChange={choose}
      />
    </div>
  )
}

/** One paired device's permissions, each changeable: off, this time, for a while or always. */
export function DevicePermissionList({ device, invoke }: { device: NetworkDevice; invoke: PermissionInvoke }) {
  if (device.role === 'viewer') return null
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
      {DEVICE_PERMISSIONS.map((permission) => (
        <PermissionLine key={permission} device={device} permission={permission} invoke={invoke} />
      ))}
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
  const [access, stageAccess] = useStagedValue<string>(`ceiling:${deviceId}`, value, (next) =>
    invoke('network.setHostAccess', deviceId, next),
  )
  return (
    <>
      <Dropdown
        label={t('Most access for its threads')}
        value={access}
        options={[
          { value: 'edits', label: t('Allow edits') },
          { value: 'auto', label: t('Auto') },
          { value: 'full', label: t('Full access') },
        ]}
        onChange={stageAccess}
      />
      {access !== 'edits' && (
        <p className="m-0 text-caption text-warn" role="note">
          {t(
            'The other host’s agent writes what these threads do. If it is compromised, it can run commands here without asking you.',
          )}
        </p>
      )}
    </>
  )
}

/** This computer's agent hosts, shared by every host row and the switch for all of them. */
export interface AgentHostsControl {
  hosts: AgentHostSummary[] | null
  refresh: () => Promise<unknown>
  /** The latest use of the switch for every host; `seq` is 0 until it is used. */
  everywhere: { on: boolean; seq: number }
}

/** What this device holds on another host, followed while a request waits for that host's answer. */
function useHostPermissions(host: string) {
  const [view, setView] = useState<DevicePermissionsView | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(
    () =>
      invokeOn(host, 'device.permissions').then(
        (next) => {
          setView(next)
          setError('')
        },
        (reason) => {
          setView(null)
          setError(errorText(reason))
        },
      ),
    [host],
  )
  useEffect(() => {
    void load()
  }, [load])
  const waiting = !!view?.pending.length
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
  }, [waiting, load])
  const request = (permissions: DevicePermission[]) =>
    Promise.all(permissions.map((permission) => invokeOn(host, 'device.requestPermission', permission))).then(
      load,
      (reason) => setError(errorText(reason)),
    )
  return { view, error, request }
}

const HOST_PERMISSIONS = DEVICE_PERMISSIONS.filter((permission) => permission !== 'agents')
const labels = (permissions: DevicePermission[]) =>
  permissions.map((permission) => t(PERMISSION_LABEL[permission])).join(', ')

/**
 * On a host's row: whether agents here may start threads there, and what this device still lacks there with one tap to
 * ask for all of it. A device holding everything sees no permission line at all.
 */
export function HostAccess({ computer, agents }: { computer: Computer; agents: AgentHostsControl }) {
  const { view, error, request } = useHostPermissions(computer.id)
  if (!view) return error ? <p className="m-0 text-caption text-muted-foreground">{error}</p> : null
  const now = Date.now()
  const missing = HOST_PERMISSIONS.filter((permission) => !grantActive(view.permissions[permission] ?? undefined, now))
  const declined = missing.filter((permission) => view.blocked?.includes(permission))
  const asked = missing.filter((permission) => view.pending.includes(permission) && !declined.includes(permission))
  const askable = missing.filter((permission) => !declined.includes(permission) && !asked.includes(permission))
  const notes = [
    askable.length ? t('Not allowed: {0}', { 0: labels(askable) }) : '',
    asked.length ? t('Waiting for {0} to allow {1}', { 0: computer.name, 1: labels(asked) }) : '',
    declined.length ? t('Declined by the host: {0}', { 0: labels(declined) }) : '',
  ].filter(Boolean)
  return (
    <>
      {computer.url && !computer.ssh && (
        <AgentsSwitch
          computer={{ ...computer, url: computer.url }}
          agents={agents}
          held={!!view.permissions.agents}
          asked={view.pending.includes('agents')}
          declined={!view.permissions.agents && !!view.blocked?.includes('agents')}
          onRequest={() => void request(['agents'])}
        />
      )}
      {notes.length > 0 && (
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1">{notes.join(' · ')}</span>
          {askable.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void request(askable)}>
              {t('Request')}
            </Button>
          )}
        </div>
      )}
      {error && <p className="m-0 text-caption text-bad">{error}</p>}
    </>
  )
}

/**
 * Agents on this computer using that host. The host grants the permission; this computer then pairs its own server with
 * a code the grant allows, so no code passes through a person. Asking and being granted connects without a second step.
 */
function AgentsSwitch({
  computer,
  agents,
  held,
  asked,
  declined,
  onRequest,
}: {
  computer: Computer & { url: string }
  agents: AgentHostsControl
  held: boolean
  asked: boolean
  declined: boolean
  onRequest: () => void
}) {
  const { hosts, refresh, everywhere } = agents
  const [wanted, setWanted] = useState(false)
  const [busy, setBusy] = useState(false)
  const linked = hosts?.find((host) => sameAddress(host.address, computer.url))
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
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
  const turnOn = () => {
    if (held) void connect()
    else {
      setWanted(true)
      if (!asked) onRequest()
    }
  }
  // The switch for every host acts through each row, so a host still gets asked or connected the one way.
  useEffect(() => {
    if (!everywhere.seq || !hosts) return
    if (!everywhere.on) {
      setWanted(false)
      if (linked) void run(() => invoke('network.forgetAgentHost', linked.id))
      return
    }
    if (!linked && !declined) turnOn()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per use of the switch
  }, [everywhere.seq])
  useEffect(() => {
    if (!wanted || !held || !hosts) return
    setWanted(false)
    if (!linked) void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the grant arrives; `connect` reads the current render
  }, [wanted, held, hosts])
  const label = t('Agents here can start threads on {0}', { 0: computer.name })
  return (
    <div className="flex min-h-7 items-center gap-3">
      <SettingsLabel
        title={label}
        help={
          declined
            ? t('Declined by the host')
            : !linked && (asked || wanted)
              ? t('Waiting for {0} to allow it', { 0: computer.name })
              : undefined
        }
      />
      <Switch
        aria-label={label}
        checked={!!linked || (wanted && !declined)}
        disabled={busy || !hosts || (declined && !linked)}
        onCheckedChange={(on) => {
          if (on) turnOn()
          else if (linked) void run(() => invoke('network.forgetAgentHost', linked.id))
          else setWanted(false)
        }}
      />
    </div>
  )
}

/** In a host's connection settings: each thing this device may do there, with a request for anything missing. */
export function HostPermissionList({ computer }: { computer: Computer }) {
  const { view, error, request } = useHostPermissions(computer.id)
  if (!view) return error ? <p className="m-0 text-caption text-muted-foreground">{error}</p> : null
  return (
    <div className="flex flex-col gap-2">
      {HOST_PERMISSIONS.map((permission) => {
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
              <Button size="sm" variant="secondary" disabled={asked} onClick={() => void request([permission])}>
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
