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
import { space } from '../theme'
import { Button, Card, Divider, Row, SectionLabel } from './ui'
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
          return (
            <View key={permission}>
              {index ? <Divider inset={space.l} /> : null}
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel title={t(PERMISSION_LABEL[permission])} help={grantText(grant, t)} />
                {!grant ? (
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

/** Next to a refusal for a missing permission: asks the person at the host for it in one tap. */
export function RequestPermission({ computerId, message }: { computerId: string; message: string }) {
  const store = useStore()
  const permission = refusedPermission(message)
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
