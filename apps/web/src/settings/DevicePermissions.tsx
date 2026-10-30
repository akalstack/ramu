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
  type DevicePermission,
  type PermissionDuration,
  type DevicePermissionsView,
  type PermissionGrant,
} from '@ramu/shared/devicePermissions'
import type { NetworkDevice, NetworkStatus } from '@ramu/shared/types'
import { useCallback, useEffect, useState } from 'react'
import { Dropdown } from '../Menu'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { t } from '../i18n'

/** Runs one host-only permission change and shows the host's updated status. */
export type PermissionInvoke = (
  method: 'network.setDevicePermission' | 'network.decidePermission' | 'network.setDefaultPermissions',
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
    <div className="mb-3 flex flex-wrap gap-2 pl-1">
      {DEVICE_PERMISSIONS.map((permission) => {
        const grant = held(permission)
        return (
          <Dropdown
            key={permission}
            label={`${t(PERMISSION_LABEL[permission])}: ${grantText(grant)}`}
            value=""
            placeholder={`${t(PERMISSION_LABEL[permission])} · ${grantText(grant)}`}
            options={[
              ...PERMISSION_DURATIONS.map((duration) => ({ value: duration, label: t(DURATION_LABEL[duration]) })),
              { value: 'revoke', label: t('Off') },
            ]}
            onChange={(value) =>
              void invoke('network.setDevicePermission', device.id, permission, value as PermissionDuration | 'revoke')
            }
          />
        )
      })}
    </div>
  )
}

/** What this computer may do on another host, with a request for anything missing. The other host decides. */
export function ThisDevicePermissions({ host }: { host: string }) {
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
  if (!view) return error ? <p className="m-0 text-caption text-muted-foreground">{error}</p> : null
  return (
    <div className="flex flex-col gap-2">
      <strong className="text-body font-medium">{t('This computer on that host')}</strong>
      {DEVICE_PERMISSIONS.map((permission) => {
        const grant = view.permissions[permission]
        const asked = view.pending.includes(permission)
        return (
          <div key={permission} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-body">{t(PERMISSION_LABEL[permission])}</span>
              <span className="block text-caption text-muted-foreground">{grantText(grant)}</span>
            </span>
            {!grant && (
              <Button
                size="sm"
                variant="secondary"
                disabled={asked}
                onClick={() =>
                  void invokeOn(host, 'device.requestPermission', permission).then(load, (reason) =>
                    setError(errorText(reason)),
                  )
                }
              >
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
