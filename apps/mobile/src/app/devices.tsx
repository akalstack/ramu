import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SvgXml } from 'react-native-svg'
import QRCode from 'qrcode'
import { ChevronDown, Link2 } from 'lucide-react-native'
import { osLine } from '@ramu/shared/deviceOs'
import { countdown, defaultPairUrl, pairQrText } from '@ramu/shared/pairingOffer'
import type { NetworkStatus, PairingOffer } from '@ramu/shared/types'
import { DeviceIcon } from '../components/DeviceIcon'
import { PermissionNeeded } from '../components/DevicePermissions'
import { Header, PageScrollView as ScrollView, Screen } from '../components/Screen'
import { Hint, RowLabel, TextRow } from '../components/SettingRows'
import { Button, Card, Divider, Row, SectionLabel, Segmented, T } from '../components/ui'
import { ago, useSay } from '../i18n'
import { deviceRows, devicesAccess, othersCount, type DeviceRow } from '../runtime/hostDevices'
import { goBackOrHome } from '../runtime/navigation'
import { correlationId } from '../runtime/correlationId'
import { useStore } from '../runtime/store'
import { showError } from '../runtime/toast'
import { font, radius, space, useTheme } from '../theme'

type Role = 'owner' | 'viewer'
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The selected host's paired phones and computers, managed from this phone: who they are, when each was last seen,
 * rename, remove, remove the others, and connect a new one with a code. Needs full access and the host's Change
 * settings permission; without it the screen says so and asks for it. The host records every change and tells the
 * person there.
 */
export default function Devices() {
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const { c } = useTheme()
  const host = store.computers.find((computer) => computer.id === store.selected)
  const access = devicesAccess(host?.access, store.permissions[store.selected], Date.now())
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const hostId = host?.id
  const online = host?.status === 'online'
  const call = useCallback(
    async (work: () => Promise<NetworkStatus>) => {
      try {
        setStatus(await work())
        setError(null)
      } catch (cause) {
        showError(message(cause))
      }
    },
    [setStatus],
  )
  useEffect(() => {
    if (!hostId || !online || access !== 'manage') return
    let live = true
    const load = () =>
      store.invoke(hostId, 'network.status').then(
        (next) => {
          if (!live) return
          setStatus(next)
          setError(null)
        },
        (cause) => live && setError(message(cause)),
      )
    void load()
    // Pairing finishes on the other device, so the list follows it while this screen is open.
    const timer = setInterval(() => void load(), 2500)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [hostId, online, access, store])
  if (!host) return null
  const rows = status ? deviceRows(status) : []
  const others = othersCount(rows)
  const remove = (row: DeviceRow) =>
    Alert.alert(
      row.self ? say('Remove this phone from {0}?', { 0: host.name }) : say('Remove {0}?', { 0: row.device.name }),
      row.self
        ? say('This phone disconnects at once and must be paired again to reconnect.')
        : say('It stops working right away and must be paired again to reconnect.'),
      [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Remove'),
          style: 'destructive',
          onPress: () => {
            if (!row.self) return void call(() => store.invoke(host.id, 'network.revoke', row.device.id))
            void store.invoke(host.id, 'network.revoke', row.device.id).then(
              () => void store.forget(host.id).finally(() => goBackOrHome(router)),
              (cause) => showError(message(cause)),
            )
          },
        },
      ],
    )
  const removeOthers = () =>
    Alert.alert(
      say('Remove {0} devices?', { 0: String(others) }),
      say(
        'Every other phone and computer paired with {0} stops working right away and must pair again. This phone keeps working, and so do linked hosts.',
        { 0: host.name },
      ),
      [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Remove all'),
          style: 'destructive',
          onPress: () => void call(() => store.invoke(host.id, 'network.revokeOthers')),
        },
      ],
    )
  return (
    <Screen bg="window">
      <Header modal title={say('Devices')} subtitle={host.name} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        {access === 'viewer' ? (
          <Hint>
            {say('This phone has view-only access to {0}, so its devices are managed elsewhere.', { 0: host.name })}
          </Hint>
        ) : access === 'request' ? (
          <View style={{ padding: space.l, gap: space.m }}>
            <T tone="muted" size={font.control}>
              {say('Connect and remove the devices paired with {0} from this phone. The person there allows it once.', {
                0: host.name,
              })}
            </T>
            <PermissionNeeded computerId={host.id} permission="settings" />
          </View>
        ) : !online ? (
          <Hint>{say('Connect to {0} to manage its devices.', { 0: host.name })}</Hint>
        ) : error ? (
          <Hint>{error}</Hint>
        ) : !status ? (
          <Hint>{say('Checking this host…')}</Hint>
        ) : (
          <>
            <SectionLabel>{say('Connect a device')}</SectionLabel>
            {connecting ? (
              <PairCode hostId={host.id} name={status.discovery?.name} onDone={() => setConnecting(false)} />
            ) : (
              <Card style={{ marginHorizontal: space.l }}>
                <Row onPress={() => setConnecting(true)}>
                  <Link2 size={17} color={c.primary} />
                  <RowLabel
                    title={say('Connect a device…')}
                    help={say('Shows a QR code and a one-time code for a phone or computer to pair with {0}.', {
                      0: host.name,
                    })}
                  />
                </Row>
              </Card>
            )}
            <PairingRequests
              status={status}
              onAnswer={(requestId, answer) =>
                void call(() =>
                  answer === 'deny'
                    ? store.invoke(host.id, 'network.denyRequest', requestId)
                    : store.invoke(host.id, 'network.approveRequest', requestId, answer),
                )
              }
            />
            <SectionLabel>{say('Devices')}</SectionLabel>
            <Card style={{ marginHorizontal: space.l }}>
              {rows.map((row, index) => (
                <View key={row.device.id}>
                  {index ? <Divider inset={space.l} /> : null}
                  <DeviceLine
                    row={row}
                    open={open === row.device.id}
                    onToggle={() => setOpen(open === row.device.id ? null : row.device.id)}
                  />
                  {open === row.device.id ? (
                    <>
                      <TextRow
                        title={say('Name')}
                        help={say('How {0} lists it.', { 0: host.name })}
                        value={row.device.name}
                        maxLength={60}
                        onCommit={(name) =>
                          void call(() =>
                            store.invoke(host.id, 'network.renameDevice', row.device.id, name.trim() || null),
                          )
                        }
                      />
                      <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
                        <Button kind="danger" title={say('Remove')} onPress={() => remove(row)} />
                      </View>
                    </>
                  ) : null}
                </View>
              ))}
              {!rows.length ? (
                <T tone="muted" size={font.control} style={{ padding: space.m }}>
                  {say('No devices paired yet.')}
                </T>
              ) : null}
            </Card>
            {others ? (
              <View style={{ paddingHorizontal: space.l, paddingTop: space.m }}>
                <Button kind="secondary" title={say('Remove others')} onPress={removeOthers} />
              </View>
            ) : null}
            <Hint>
              {say('{0} shows each change made here. Permissions and how long devices stay paired are set there.', {
                0: host.name,
              })}
            </Hint>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

function DeviceLine({ row, open, onToggle }: { row: DeviceRow; open: boolean; onToggle: () => void }) {
  const say = useSay()
  const { c } = useTheme()
  const { device } = row
  const seen = device.lastSeenAt ? say('last seen {0}', { 0: ago(device.lastSeenAt) }) : say('never seen')
  const detail = [osLine(device.os), device.role === 'viewer' ? say('View only') : say('Full access'), seen]
    .filter(Boolean)
    .join(' · ')
  const name = row.self ? say('{0} (this phone)', { 0: device.name }) : device.name
  return (
    <Row
      onPress={onToggle}
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${name}, ${detail}`}
      style={{ paddingVertical: space.m }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.s + 2,
          backgroundColor: c.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <DeviceIcon os={device.os} name={device.name} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="600" numberOfLines={1}>
          {name}
        </T>
        <T size={font.caption} tone="muted" numberOfLines={2}>
          {detail}
        </T>
      </View>
      <ChevronDown size={16} color={c.muted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
    </Row>
  )
}

/** Nearby devices asking to pair: allowed only when the six-digit number matches the one on the other screen. */
function PairingRequests({
  status,
  onAnswer,
}: {
  status: NetworkStatus
  onAnswer: (requestId: string, answer: Role | 'deny') => void
}) {
  const say = useSay()
  if (!status.requests.length) return null
  return (
    <>
      <SectionLabel>{say('Asking to pair')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {status.requests.map((request, index) => (
          <View key={request.id} style={{ padding: space.l, gap: space.s }}>
            {index ? <Divider /> : null}
            <RowLabel
              title={request.name || say('A device')}
              help={say('Allow it only if it shows {0}.', { 0: request.code })}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              <Button title={say('Full access')} onPress={() => onAnswer(request.id, 'owner')} />
              <Button kind="secondary" title={say('View only')} onPress={() => onAnswer(request.id, 'viewer')} />
              <Button kind="ghost" title={say('Deny')} onPress={() => onAnswer(request.id, 'deny')} />
            </View>
          </View>
        ))}
      </Card>
    </>
  )
}

/**
 * A one-time code made on the host for a new device: a QR code another phone's camera opens, the code to type, and the
 * access it grants. Replaced when it runs out, followed until a device uses it, and withdrawn when closed.
 */
function PairCode({ hostId, name, onDone }: { hostId: string; name?: string; onDone: () => void }) {
  const say = useSay()
  const store = useStore()
  const [role, setRole] = useState<Role>('owner')
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [joined, setJoined] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [qr, setQr] = useState('')
  // One owner per screen, so its next code replaces only its own unused one on the host.
  const owner = useRef(correlationId()).current
  const expired = !!offer && offer.expiresAt <= now
  useEffect(() => {
    if (joined) return
    let live = true
    setOffer(null)
    void store.invoke(hostId, 'network.pair', role, owner).then(
      (next) => live && setOffer(next),
      (cause) => live && showError(message(cause)),
    )
    return () => {
      live = false
    }
    // `expired` asks for a fresh code once the old one runs out.
  }, [hostId, role, owner, store, joined, expired])
  const offerId = offer?.offerId
  useEffect(() => {
    if (!offerId) return
    const timer = setInterval(() => {
      setNow(Date.now())
      void store.invoke(hostId, 'network.offer', offerId).then(
        (result) => {
          if (result.state === 'redeemed' && result.device) setJoined(result.device.name)
        },
        () => {},
      )
    }, 1500)
    return () => {
      clearInterval(timer)
      void store.invoke(hostId, 'network.cancelOffer', offerId).catch(() => {})
    }
  }, [hostId, offerId, store])
  const url = offer ? defaultPairUrl(offer.urls) : undefined
  const link = offer && url ? pairQrText(offer, url, name) : null
  useEffect(() => {
    let live = true
    setQr('')
    if (link)
      void QRCode.toString(link, { type: 'svg', margin: 2 }).then(
        (svg) => live && setQr(svg),
        () => {},
      )
    return () => {
      live = false
    }
  }, [link])
  if (joined)
    return (
      <Card style={{ marginHorizontal: space.l }}>
        <View style={{ padding: space.l, gap: space.m }}>
          <T weight="600">{say('{0} is paired', { 0: joined })}</T>
          <Button kind="secondary" title={say('Done')} onPress={onDone} />
        </View>
      </Card>
    )
  return (
    <Card style={{ marginHorizontal: space.l }}>
      <View style={{ padding: space.l, gap: space.m, alignItems: 'stretch' }}>
        <Segmented<Role>
          value={role}
          onChange={setRole}
          options={[
            { key: 'owner', label: say('Full access') },
            { key: 'viewer', label: say('View only') },
          ]}
        />
        <View
          accessible
          accessibilityLabel={say('Pairing QR code')}
          style={{ alignSelf: 'center', backgroundColor: '#ffffff', borderRadius: radius.m, padding: space.s }}
        >
          {qr ? <SvgXml xml={qr} width={220} height={220} /> : <View style={{ width: 220, height: 220 }} />}
        </View>
        <T size={font.title} weight="600" selectable style={{ textAlign: 'center', letterSpacing: 2 }}>
          {offer?.code ?? '·····-·····'}
        </T>
        <T size={font.caption} tone="muted" style={{ textAlign: 'center' }}>
          {offer
            ? say('Scan it with the other device’s camera, or type the code. A new one replaces it in {0}.', {
                0: countdown(offer.expiresAt, now),
              })
            : say('Making a code…')}
        </T>
        <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'center' }}>
          {link ? (
            <Button kind="secondary" title={say('Share link')} onPress={() => void Share.share({ message: link })} />
          ) : null}
          <Button kind="ghost" title={say('Close')} onPress={onDone} />
        </View>
      </View>
    </Card>
  )
}
