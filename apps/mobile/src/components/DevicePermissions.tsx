import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import {
  DEVICE_PERMISSIONS,
  PERMISSION_LABEL,
  grantActive,
  refusedPermission,
  type DevicePermission,
  type DevicePermissionsView,
  type PermissionGrant,
} from '@ramu/shared/devicePermissions'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, Card, Divider, Row, SectionLabel, T } from './ui'
import { RowLabel } from './SettingRows'

function grantText(grant: PermissionGrant | null, t: (text: string, values?: Record<string, string>) => string) {
  if (!grant || !grantActive(grant, Date.now())) return t('Off')
  if (grant.session) return t('This time')
  if (grant.until === null) return t('Always')
  return t('Until {0}', { 0: new Date(grant.until).toLocaleString() })
}

/** What this phone may do on a host, with a request for anything missing. A person at the host decides. */
export function PhonePermissions({ computerId }: { computerId: string }) {
  const store = useStore()
  const t = (text: string, values?: Record<string, string>) => translate(store.language, text, values)
  const online = store.isOnline(computerId)
  const [view, setView] = useState<DevicePermissionsView | null>(null)
  const load = useCallback(() => {
    if (!online) return
    void store.invoke(computerId, 'device.permissions').then(setView, () => setView(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads per host and connection, not per store render
  }, [computerId, online])
  useEffect(load, [load])
  if (!view) return null
  return (
    <>
      <SectionLabel>{t('Permissions on this host')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {DEVICE_PERMISSIONS.map((permission, index) => {
          const grant = view.permissions[permission]
          const asked = view.pending.includes(permission)
          const declined = !grant && !!view.blocked?.includes(permission)
          return (
            <View key={permission}>
              {index ? <Divider inset={space.l} /> : null}
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel
                  title={t(PERMISSION_LABEL[permission])}
                  help={declined ? t('Declined by the host') : grantText(grant, t)}
                />
                {!grant && !declined ? (
                  <Button
                    kind="secondary"
                    title={asked ? t('Asked') : t('Request')}
                    disabled={asked}
                    onPress={() =>
                      void store.invoke(computerId, 'device.requestPermission', permission).then(load, load)
                    }
                  />
                ) : null}
              </Row>
            </View>
          )
        })}
      </Card>
    </>
  )
}

/**
 * Asks the person at the host for a missing permission in one tap: next to a refusal (`message`), or where a control is
 * hidden because the host has not granted it (`permission`).
 */
export function RequestPermission({
  computerId,
  message,
  permission: needed,
}: {
  computerId: string
  message?: string
  permission?: DevicePermission
}) {
  const store = useStore()
  const permission = needed ?? (message ? refusedPermission(message) : null)
  const [asked, setAsked] = useState<DevicePermission | null>(null)
  if (!permission) return null
  return (
    <Button
      kind="secondary"
      title={
        asked === permission
          ? translate(store.language, 'Asked · allow it on the host')
          : translate(store.language, 'Request access')
      }
      disabled={asked === permission}
      onPress={() =>
        void store.invoke(computerId, 'device.requestPermission', permission).then(
          () => setAsked(permission),
          () => setAsked(permission),
        )
      }
    />
  )
}

/** Shown in place of a control this phone may not use on the host: what is missing, and a request for it. */
export function PermissionNeeded({ computerId, permission }: { computerId: string; permission: DevicePermission }) {
  const store = useStore()
  return (
    <View style={{ gap: space.s }}>
      <T size={font.control} tone="muted">
        {translate(store.language, 'This device needs {0} on this host.', {
          0: translate(store.language, PERMISSION_LABEL[permission]),
        })}
      </T>
      <RequestPermission computerId={computerId} permission={permission} />
    </View>
  )
}
