import { useState } from 'react'
import { View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import {
  DEVICE_PERMISSIONS,
  PERMISSION_LABEL,
  grantActive,
  refusedPermission,
  type DevicePermission,
  type PermissionGrant,
} from '@ramu/shared/devicePermissions'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, Card, Divider, Row, SectionLabel, T } from './ui'
import { Hint, RowLabel } from './SettingRows'

function grantText(grant: PermissionGrant, t: (text: string, values?: Record<string, string>) => string) {
  if (grant.session) return t('Allowed while connected')
  if (grant.until === null) return t('Allowed')
  return t('Allowed until {0}', {
    0: new Date(grant.until).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
  })
}

// Agents is for another computer's agents; a phone has none to bring.
const PHONE_PERMISSIONS = DEVICE_PERMISSIONS.filter((permission) => permission !== 'agents')

/**
 * What this phone may do on a host, with a request for anything missing. A person at the host decides, and the answer
 * shows here as soon as they give it.
 */
export function PhonePermissions({ computerId }: { computerId: string }) {
  const store = useStore()
  const t = (text: string, values?: Record<string, string>) => translate(store.language, text, values)
  const view = store.permissions[computerId]
  if (!view) return null
  const now = Date.now()
  const waiting = view.pending.length > 0
  return (
    <>
      <SectionLabel>{t('Permissions on this host')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {PHONE_PERMISSIONS.map((permission, index) => {
          const grant = view.permissions[permission]
          const held = grant && grantActive(grant, now) ? grant : null
          const asked = view.pending.includes(permission)
          const declined = !held && !!view.blocked?.includes(permission)
          return (
            <View key={permission}>
              {index ? <Divider inset={space.l} /> : null}
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel
                  title={t(PERMISSION_LABEL[permission])}
                  help={
                    held
                      ? grantText(held, t)
                      : declined
                        ? t('Declined by the host')
                        : asked
                          ? t('Waiting for the host')
                          : t('Not allowed')
                  }
                />
                {!held && !declined ? (
                  <Button
                    kind="secondary"
                    title={asked ? t('Asked') : t('Request')}
                    disabled={asked}
                    onPress={() =>
                      void store
                        .invoke(computerId, 'device.requestPermission', permission)
                        .finally(() => store.reloadPermissions(computerId))
                    }
                  />
                ) : null}
              </Row>
            </View>
          )
        })}
      </Card>
      {waiting ? <Hint>{t('Allow it in Ramu on the host. It updates here when they answer.')}</Hint> : null}
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
