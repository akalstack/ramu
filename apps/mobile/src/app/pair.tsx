import { useEffect, useRef, useState } from 'react'
import {
  AppState,
  KeyboardAvoidingView,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { needsHttpConsent } from '../runtime/transport'
import { decodePairQr, parsePairInput } from '@ramu/contracts'
import { CameraOff, Monitor, QrCode, ShieldAlert } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { GlassButton, Header, Screen, useSheetKeyboardOffset, PageScrollView as ScrollView } from '../components/Screen'
import { Card, T, Toggle, tap } from '../components/ui'
import { animateLayout } from '../components/Motion'
import { fill, useT } from '../i18n'
import { reviewSelection } from '@ramu/shared/discovery/tracker'
import { useNearbyHosts } from '../runtime/nearby'
import {
  availableMethods,
  browsingActive,
  cameraActive,
  initialMethod,
  pairingFill,
  type PairMethod,
} from '../runtime/nearbyModel'

const LENGTH = 10

export default function Pair() {
  const keyboardOffset = useSheetKeyboardOffset()
  const { c } = useTheme()
  const router = useRouter()
  const { pair } = useStore()
  const params = useLocalSearchParams<{ url?: string; code?: string; exp?: string; name?: string }>()
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [http, setHttp] = useState(false)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const live = Platform.OS !== 'web'
  // Nearby hosts come first. Opening this screen never starts the camera: it opens only for the QR method.
  const [method, setMethod] = useState<PairMethod>(() => initialMethod(live, Boolean(params.url)))
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [selected, setSelected] = useState<{ key: string; url: string } | null>(null)
  const [scanning, setScanning] = useState(true)
  const [permission, requestPermission] = useCameraPermissions()
  const asked = useRef(false)
  const scanned = useRef(false)
  const codeField = useRef<TextInput>(null)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])
  const camera = cameraActive(method, foreground)
  useEffect(() => {
    if (!camera || !permission || permission.granted || !permission.canAskAgain || asked.current) return
    asked.current = true
    void requestPermission()
  }, [camera, permission, requestPermission])
  const nearby = useNearbyHosts(browsingActive(method, foreground))
  const choose = (next: PairMethod) => {
    tap()
    animateLayout()
    scanned.current = false
    setScanning(true)
    setMethod(next)
  }
  // A `ramu://pair?url=…&code=…` link opened from outside the app arrives as route parameters.
  useEffect(() => {
    if (!params.url) return
    try {
      const query = new URLSearchParams(
        Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ).toString()
      const offer = parsePairInput(`ramu://pair?${query}`)
      setAddress(offer.url)
      if (offer.code) setCode(offer.code.replace('-', ''))
      if (offer.name) setName((current) => current || offer.name!)
      setHttp(false)
      setMethod('manual')
    } catch (error) {
      Alert.alert('Cannot use this link', error instanceof Error ? error.message : String(error))
    }
  }, [params.url, params.code, params.exp, params.name])
  const insecure = needsHttpConsent(address)
  const ready = address.trim().length > 3 && code.length === LENGTH && (!insecure || http)

  const { width } = useWindowDimensions()
  const side = Math.min(width - space.l * 2, 320)
  const showCamera = camera && scanning && permission?.granted === true
  const showFields = method === 'manual'
  const methods = availableMethods(live)
  const label: Record<PairMethod, string> = { nearby: t.pairNearby, qr: t.pairScanQr, manual: t.pairManual }
  const current = nearby.state.hosts.find((host) => host.key === selected?.key)
  const review = reviewSelection(nearby.state.hosts, selected?.key ?? null, selected?.url ?? null)
  const field = {
    color: c.text,
    fontSize: font.body,
    height: 46,
    paddingHorizontal: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  } as const
  const corner = { position: 'absolute', width: 30, height: 30, borderColor: '#ffffff', opacity: 0.9 } as const
  const rescan = () => {
    tap()
    scanned.current = false
    setScanning(true)
  }

  return (
    <Screen bg="canvas">
      <Header modal title="Pair a host" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, gap: space.l, alignItems: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          {methods.length > 1 ? (
            <View
              accessibilityRole="tablist"
              accessibilityLabel={t.pairMethods}
              style={{ flexDirection: 'row', gap: space.xs, alignSelf: 'stretch' }}
            >
              {methods.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: method === item }}
                  onPress={() => choose(item)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: space.s,
                    borderRadius: radius.m,
                    backgroundColor: method === item ? c.raised2 : 'transparent',
                  }}
                >
                  <T
                    size={font.control}
                    weight={method === item ? '600' : '500'}
                    tone={method === item ? 'accent' : 'soft'}
                    style={{ textAlign: 'center' }}
                  >
                    {label[item]}
                  </T>
                </Pressable>
              ))}
            </View>
          ) : null}

          {method === 'nearby' ? (
            <View style={{ width: '100%', gap: space.m }}>
              <T size={font.control} tone="muted" style={{ lineHeight: 19 }}>
                {t.nearbyIntro}
              </T>
              <T accessibilityLiveRegion="polite" size={font.control} tone="muted" style={{ lineHeight: 19 }}>
                {nearby.state.status === 'denied'
                  ? t.nearbyDenied
                  : nearby.state.status === 'unavailable'
                    ? t.nearbyUnavailable
                    : nearby.state.status === 'searching' && !nearby.state.hosts.length
                      ? t.nearbySearching
                      : nearby.state.timedOut && !nearby.state.hosts.length
                        ? t.nearbyTimedOut
                        : !nearby.state.hosts.length
                          ? t.nearbyNone
                          : ''}
              </T>
              {nearby.state.hosts.map((host) => {
                const route = host.routes[0]
                const active = selected?.key === host.key
                return (
                  <Pressable
                    key={host.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      if (!route) return
                      tap()
                      setSelected({ key: host.key, url: route.url })
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.m,
                      padding: space.m,
                      minHeight: 56,
                      borderRadius: radius.m,
                      backgroundColor: active ? c.raised2 : c.fill,
                    }}
                  >
                    <Monitor size={18} color={c.soft} />
                    <View style={{ flex: 1 }}>
                      <T weight="600" numberOfLines={1}>
                        {host.label}
                      </T>
                      <T size={font.caption} tone="muted" numberOfLines={1}>
                        {route ? route.url.replace(/^https?:\/\//, '') : ''}
                        {host.scheme === 'http' ? ` · ${t.nearbyPlain}` : ''}
                        {host.pairedHostId ? ` · ${t.nearbyPaired}` : ''}
                      </T>
                    </View>
                  </Pressable>
                )
              })}
              {selected && current ? (
                <View style={{ gap: space.s }}>
                  {review === 'changed' ? (
                    <T size={font.control} tone="warn" accessibilityRole="alert">
                      {t.nearbyChanged}
                    </T>
                  ) : null}
                  {current.routes.length > 1
                    ? current.routes.map((route) => (
                        <Pressable
                          key={route.url}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: selected.url === route.url }}
                          onPress={() => setSelected({ key: current.key, url: route.url })}
                          style={{ paddingVertical: space.s }}
                        >
                          <T tone={selected.url === route.url ? 'accent' : 'soft'}>
                            {route.url.replace(/^https?:\/\//, '')}
                            {route.interfaceName ? ` · ${route.interfaceName}` : ''}
                          </T>
                        </Pressable>
                      ))
                    : null}
                  <GlassButton
                    primary
                    title={fill(t.nearbyContinue, current.label)}
                    disabled={!current.routes.some((route) => route.url === selected.url)}
                    onPress={() => {
                      const choice = pairingFill(current, selected.url)
                      if (!choice) return
                      setAddress(choice.address)
                      setName((existing) => existing || choice.name)
                      setCode('')
                      setHttp(false)
                      animateLayout()
                      setMethod('manual')
                      setTimeout(() => codeField.current?.focus(), 250)
                    }}
                  />
                </View>
              ) : null}
              {selected && !current ? (
                <T size={font.control} tone="warn" accessibilityRole="alert">
                  {t.nearbyGone}
                </T>
              ) : null}
              {nearby.state.status === 'denied' ? (
                <GlassButton title={t.dictateOpenSettings} onPress={() => void Linking.openSettings()} />
              ) : null}
              <GlassButton title={t.nearbyRetry} onPress={nearby.retry} />
            </View>
          ) : null}

          {method === 'qr' ? (
            <>
              <View
                style={{
                  width: side,
                  height: side,
                  borderRadius: radius.l,
                  overflow: 'hidden',
                  backgroundColor: c.raised2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showCamera ? (
                  <>
                    <CameraView
                      style={StyleSheet.absoluteFill}
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={({ data }) => {
                        if (scanned.current) return
                        scanned.current = true
                        try {
                          const offer = decodePairQr(data)
                          setAddress(offer.url)
                          setCode(offer.code.replace('-', ''))
                          setHttp(false)
                          setScanning(false)
                          // The scanned address and code are shown for review in the manual fields.
                          setMethod('manual')
                        } catch (error) {
                          setScanning(false)
                          Alert.alert('Cannot scan offer', error instanceof Error ? error.message : String(error))
                        }
                      }}
                    />
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                      <View
                        style={{
                          ...corner,
                          top: 20,
                          left: 20,
                          borderTopWidth: 3,
                          borderLeftWidth: 3,
                          borderTopLeftRadius: 10,
                        }}
                      />
                      <View
                        style={{
                          ...corner,
                          top: 20,
                          right: 20,
                          borderTopWidth: 3,
                          borderRightWidth: 3,
                          borderTopRightRadius: 10,
                        }}
                      />
                      <View
                        style={{
                          ...corner,
                          bottom: 20,
                          left: 20,
                          borderBottomWidth: 3,
                          borderLeftWidth: 3,
                          borderBottomLeftRadius: 10,
                        }}
                      />
                      <View
                        style={{
                          ...corner,
                          bottom: 20,
                          right: 20,
                          borderBottomWidth: 3,
                          borderRightWidth: 3,
                          borderBottomRightRadius: 10,
                        }}
                      />
                    </View>
                  </>
                ) : live && permission && !permission.granted ? (
                  <View style={{ alignItems: 'center', gap: space.m, padding: space.xl }}>
                    <CameraOff size={30} color={c.muted} strokeWidth={1.6} />
                    <T size={font.control} tone="muted" style={{ textAlign: 'center', lineHeight: 19 }}>
                      {t.pairCameraOff}
                    </T>
                    <GlassButton
                      title={permission.canAskAgain ? t.pairAllowCamera : t.dictateOpenSettings}
                      onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
                    />
                  </View>
                ) : live && permission ? (
                  <View style={{ alignItems: 'center', gap: space.m, padding: space.xl }}>
                    <QrCode size={30} color={c.accent} strokeWidth={1.6} />
                    <T weight="600">{address ? t.pairScanned : t.pairPaused}</T>
                    <GlassButton title={t.pairScanAgain} onPress={rescan} />
                  </View>
                ) : (
                  <QrCode size={30} color={c.placeholder} strokeWidth={1.6} />
                )}
              </View>
              <T size={font.control} tone="muted" style={{ textAlign: 'center', lineHeight: 19, maxWidth: side }}>
                {t.pairQrHint}
              </T>
            </>
          ) : null}

          {showFields ? (
            <View style={{ width: '100%', gap: space.l }}>
              <View style={{ gap: space.s }}>
                <T size={font.control} weight="500" tone="soft">
                  Server address
                </T>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="https://my-mac.local:7421"
                  placeholderTextColor={c.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={field}
                />
                <T size={font.caption} tone="muted">
                  An origin only: scheme, host and port. Path prefixes are not supported.
                </T>
              </View>

              <View style={{ gap: space.s }}>
                <T size={font.control} weight="500" tone="soft">
                  Pairing code
                </T>
                <TextInput
                  ref={codeField}
                  value={code}
                  onChangeText={(v) =>
                    setCode(
                      v
                        .replace(/[^0-9A-Za-z]/g, '')
                        .toUpperCase()
                        .slice(0, LENGTH),
                    )
                  }
                  placeholder="ABCDE-FGHIJ"
                  placeholderTextColor={c.placeholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={{ ...field, fontFamily: font.mono, letterSpacing: 2 }}
                />
              </View>

              <View style={{ gap: space.s }}>
                <T size={font.control} weight="500" tone="soft">
                  Name (optional)
                </T>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Defaults to the host's own name"
                  placeholderTextColor={c.placeholder}
                  style={field}
                />
              </View>
            </View>
          ) : null}

          {showFields ? (
            <>
              {insecure ? (
                <Card style={{ width: '100%', padding: space.m, gap: space.m, backgroundColor: c.warnWash }}>
                  <View style={{ flexDirection: 'row', gap: space.s }}>
                    <ShieldAlert size={16} color={c.warn} />
                    <T size={font.control} tone="soft" style={{ flex: 1, lineHeight: 19 }}>
                      Plain HTTP sends your device token unencrypted. Only allow it on a network you trust (home LAN or
                      VPN).
                    </T>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <T size={font.control} weight="500" style={{ flex: 1 }}>
                      Allow HTTP for this host
                    </T>
                    <Toggle value={http} onValueChange={setHttp} />
                  </View>
                </Card>
              ) : null}

              <GlassButton
                primary
                style={{ alignSelf: 'stretch' }}
                title={busy ? 'Pairing…' : 'Pair'}
                disabled={!ready || busy}
                onPress={async () => {
                  setBusy(true)
                  try {
                    await pair(name.trim(), address.trim(), code, http)
                    router.dismissAll()
                  } catch (error) {
                    Alert.alert('Could not pair', error instanceof Error ? error.message : String(error))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
