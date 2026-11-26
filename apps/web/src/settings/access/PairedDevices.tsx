import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DeviceChange, NetworkDevice, NetworkStatus } from '@ramu/shared/types'
import { deviceChangeText } from '@ramu/shared/deviceChanges'
import { customDefaultPermissions, deviceLimited, type DevicePermission } from '@ramu/shared/devicePermissions'
import { osLine } from '@ramu/shared/deviceOs'
import { SettingsAdvanced, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { RowButton } from '@/components/row-button'
import { DeviceIcon } from '@/components/device-icon'
import { Dialog as ConfirmDialog, Dropdown, timeAgo } from '../../Menu'
import { errorText } from '../../lib/errors'
import { notifyError } from '../../chat/Notifications'
import { t } from '../../i18n'
import { SETTINGS_CARD_LINE, SettingsEmpty } from '../cards'
import {
  DefaultPermissions,
  DevicePermissionList,
  PermissionRequests,
  type PermissionInvoke,
} from '../DevicePermissions'
import { RenameDialog } from '../RenameDialog'
import { useSettingsInvoke } from '../SettingsScope'
import { useStagedValue } from '../stagedChanges'
import { AccessSection } from './AccessSection'

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
  return device.role === 'viewer' ? t('View only') : t('Full access')
}

/** Asks before a device stops working here; it pairs again to come back. */
export function RemoveDevice({
  name,
  onCancel,
  onConfirm,
}: {
  name: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      danger
      title={t('Remove {0}?', { 0: name })}
      confirmLabel={t('Remove')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>{t('It stops working right away and must be paired again to reconnect.')}</p>
    </ConfirmDialog>
  )
}

/**
 * The phones and computers paired with this host, each with what it may do and when it was last seen, Remove, and
 * the limits few people set (permissions, how long it stays paired) folded under Limit this device.
 */
export function PairedDevices({
  status,
  onStatus,
}: {
  status: NetworkStatus
  onStatus: (status: NetworkStatus) => void
}) {
  const invoke = useSettingsInvoke()
  const [renaming, setRenaming] = useState<NetworkDevice | null>(null)
  const [removing, setRemoving] = useState<NetworkDevice | null>(null)
  const [removingOthers, setRemovingOthers] = useState(false)
  const fail = (error: unknown) => notifyError(errorText(error), t('Devices & access'))
  const change: PermissionInvoke = async (method, ...args) => {
    try {
      onStatus(await (invoke as (method: string, ...args: unknown[]) => Promise<NetworkStatus>)(method, ...args))
    } catch (error) {
      fail(error)
    }
  }
  // Another host's agents are listed under Linked hosts, with the access their threads get.
  const devices = status.devices.filter((device) => device.kind !== 'host')
  // Set when this computer manages another host's devices: it is one of them, and that host keeps the limits.
  const self = status.self
  const others = devices.filter((device) => device.id !== self)
  const [lifetime, stageLifetime] = useStagedValue(
    'network.deviceLifetime',
    String(status.deviceLifetime?.days),
    (value) =>
      change('network.setDeviceLifetime', value === 'default' ? null : value === 'never' ? 'never' : Number(value)),
  )
  return (
    <AccessSection
      title={t('Devices')}
      help={t('Phones and computers paired with this host. Remove one and it must pair again to reconnect.')}
      actions={
        others.length > (self ? 0 : 1) ? (
          <Button variant="secondary" size="sm" onClick={() => setRemovingOthers(true)}>
            {t('Remove others')}
          </Button>
        ) : undefined
      }
    >
      {!self && <PermissionRequests status={status} invoke={change} />}
      {devices.map((device) => (
        <PairedDeviceRow
          key={device.id}
          device={device}
          self={device.id === self}
          limits={!self}
          invoke={change}
          onRemove={() => setRemoving(device)}
          onRename={() => setRenaming(device)}
          hostDays={status.deviceLifetime.days}
          defaults={status.defaultPermissions}
        />
      ))}
      {!devices.length && (
        <SettingsEmpty>{t('No devices paired yet. Connect a phone or another computer above.')}</SettingsEmpty>
      )}
      <DeviceChanges changes={status.changes ?? []} />
      {!self && (
        <SettingsAdvanced>
          {status.deviceLifetime && (
            <SettingsRow>
              <SettingsLabel
                title={t('Keep devices paired')}
                help={t(
                  'A device unused for this long must be paired again. Each use resets the timer. Changes apply when each device next connects.',
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
          {/* New devices pair with full access. A host that chose its own set before keeps it, and can still change it. */}
          {customDefaultPermissions(status.defaultPermissions ?? []) && (
            <DefaultPermissions status={status} invoke={change} />
          )}
        </SettingsAdvanced>
      )}
      {renaming && (
        <RenameDialog
          title={t('Rename {0}', { 0: renaming.name })}
          help={t('This host lists it under this name.')}
          name={renaming.name}
          original={renaming.pairedName ?? renaming.name}
          onSave={async (name) => onStatus(await invoke('network.renameDevice', renaming.id, name))}
          onClose={() => setRenaming(null)}
        />
      )}
      {removing && (
        <RemoveDevice
          name={removing.name}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void change('network.revoke', removing.id)
            setRemoving(null)
          }}
        />
      )}
      {removingOthers && (
        <ConfirmDialog
          danger
          title={t('Remove {0} devices?', { 0: others.length })}
          confirmLabel={t('Remove all')}
          onCancel={() => setRemovingOthers(false)}
          onConfirm={() => {
            setRemovingOthers(false)
            void change('network.revokeOthers')
          }}
        >
          <p>
            {t(
              'Every phone and computer paired here stops working right away and must pair again. This computer keeps working, and so do linked hosts.',
            )}
          </p>
        </ConfirmDialog>
      )}
    </AccessSection>
  )
}

/** What paired devices changed here lately, newest first, so a removal made from a phone is never a mystery. */
function DeviceChanges({ changes }: { changes: DeviceChange[] }) {
  if (!changes.length) return null
  return (
    <div className="mt-3 flex flex-col gap-1" role="list" aria-label={t('Changes from other devices')}>
      <span className="text-caption font-medium text-muted-foreground">{t('Changes from other devices')}</span>
      {changes.slice(0, 5).map((change) => (
        <span key={change.id} role="listitem" className="text-caption text-muted-foreground">
          {`${deviceChangeText(change, t)} · ${timeAgo(change.at)}`}
        </span>
      ))}
    </div>
  )
}

/** How long one device stays paired without use: its own choice, or the same as every other device here. */
function DeviceExpiry({
  device,
  hostDays,
  invoke,
}: {
  device: NetworkDevice
  hostDays: number | 'never'
  invoke: PermissionInvoke
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
          ...lifetimeOptions(device.lifetimeDays ?? hostDays, false),
        ]}
      />
    </div>
  )
}

/**
 * One paired device as a single row: name, what it may do and when it was last seen. Rename and Remove open below it,
 * with its permissions and how long it stays paired one fold further, so a long list of devices stays scannable.
 */
function PairedDeviceRow({
  device,
  self,
  limits,
  invoke,
  onRemove,
  onRename,
  hostDays,
  defaults,
}: {
  device: NetworkDevice
  /** This computer itself, on another host's list. */
  self: boolean
  /** Its permissions and pairing time, which only the host itself sets. */
  limits: boolean
  invoke: PermissionInvoke
  onRemove: () => void
  onRename: () => void
  /** This host's default pairing lifetime, which a device follows unless it has its own. */
  hostDays: number | 'never'
  /** What this host gives a new device, which a device marked Limited holds less than. */
  defaults?: readonly DevicePermission[]
}) {
  const [open, setOpen] = useState(false)
  const seen = device.lastSeenAt ? timeAgo(device.lastSeenAt) : t('never')
  const limited = deviceLimited(device, Date.now(), defaults)
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SettingsRow className="settings-stack gap-0 p-1.5" />}>
      <CollapsibleTrigger
        render={
          <RowButton
            size="lg"
            className="rounded-(--radius-s) px-2.5 py-2.5"
            aria-label={t('{0}, {1}, last seen {2}', {
              0: device.name,
              1: [deviceSummary(device), limited ? t('Limited') : ''].filter(Boolean).join(', '),
              2: seen,
            })}
          />
        }
      >
        <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-s) bg-hover text-muted-foreground">
          <DeviceIcon os={device.os} name={device.name} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-control font-medium text-foreground">
              {self ? t('{0} (this computer)', { 0: device.name }) : device.name}
            </span>
            {/* Full access means everything a new device gets; one that was cut back says so here. */}
            {limited && (
              <Badge variant="outline" className="flex-none rounded-full px-1.5 text-caption text-muted-foreground">
                {t('Limited')}
              </Badge>
            )}
          </span>
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-muted-foreground">
            {`${device.expiresAt ? t('Expires {0}', { 0: new Date(device.expiresAt).toLocaleDateString() }) : t('Never expires')} · ${t('Paired {0}', { 0: new Date(device.createdAt).toLocaleDateString() })}`}
          </span>
          <span className="flex flex-none items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onRename}>
              {t('Rename…')}
            </Button>
            <Button variant="secondary" size="sm" className="bg-fill hover:bg-fill-hover" onClick={onRemove}>
              {t('Remove')}
            </Button>
          </span>
        </div>
        {limits && (
          <Collapsible className="border-t border-border pt-1.5">
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="group/limit text-caption text-muted-foreground" />}
            >
              {t('Limit this device…')}
              <ChevronDown size={14} className="transition-transform group-data-[panel-open]/limit:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-2 pt-1">
              <DevicePermissionList device={device} invoke={invoke} />
              <DeviceExpiry device={device} hostDays={hostDays} invoke={invoke} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
