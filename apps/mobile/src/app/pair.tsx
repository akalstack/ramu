import { useEffect, useRef, useState } from 'react'
import {
  AppState,
  KeyboardAvoidingView,
  Keyboard,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { needsHttpConsent } from '../runtime/transport'
import { decodePairQr, parsePairInput } from '@ramu/contracts'
import { PairRequestUnsupported } from '@ramu/shared/pairRequest'
import { CameraOff, Monitor, QrCode, ShieldAlert } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { GlassButton, Header, Screen, useSheetKeyboardOffset, PageScrollView as ScrollView } from '../components/Screen'
import { Card, T, Toggle, tap } from '../components/ui'
import { animateLayout } from '../components/Motion'
import { fill, useSay, useT } from '../i18n'
import { LinkHosts } from '../components/LinkHosts'
import { reviewSelection } from '@ramu/shared/discovery/tracker'
import { useNearbyHosts } from '../runtime/nearby'
import type { ReviewAddressResult } from '@ramu/shared/api'
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
  const insets = useSafeAreaInsets()
  const scroll = useRef<import('react-native').ScrollViewInstance>(null)
  const pairing = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { c } = useTheme()
  const router = useRouter()
  const { pair, pairByRequest, reviewAddress, computers, probeHosts, retry, select } = useStore()
  // A request to a nearby host: the number both screens must show, once the host has answered.
  const [asking, setAsking] = useState<{ host: string; code: string | null } | null>(null)
  const askAbort = useRef<AbortController | null>(null)
  useEffect(() => () => askAbort.current?.abort(), [])
  const [moved, setMoved] = useState<ReviewAddressResult | 'checking' | null>(null)
  const params = useLocalSearchParams<{ url?: string; code?: string; exp?: string; name?: string }>()
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [http, setHttp] = useState(false)
  const [offerScanned, setOfferScanned] = useState(false)
  const [busy, setBusy] = useState(false)
  const t = useT()
  const say = useSay()
  const live = Platform.OS !== 'web'
  // Nearby hosts come first. Opening this screen never starts the camera: it opens only for the QR method.
  const [method, setMethod] = useState<PairMethod>(() => initialMethod(live, Boolean(params.url)))
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [selected, setSelected] = useState<{ key: string; url: string } | null>(null)
  const [scanning, setScanning] = useState(true)
  const [permission, requestPermission] = useCameraPermissions()
  const asked = useRef(false)
  const scanned = useRef(false)
  const codeField = useRef<import('react-native').TextInputInstance>(null)
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
  const nearby = useNearbyHosts(
    browsingActive(method, foreground),
    (hostId) => computers.find((computer) => computer.hostId === hostId)?.id ?? null,
    probeHosts,
  )
  const choose = (next: PairMethod) => {
    if (pairing.current) return
    Keyboard.dismiss()
    tap()
    animateLayout()
    scroll.current?.scrollTo({ y: 0, animated: false })
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
      Alert.alert(t.pairInvalidLink, error instanceof Error ? error.message : String(error))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [params.url, params.code, params.exp, params.name] by design; the values it reads beyond these are current as of that run
  }, [params.url, params.code, params.exp, params.name])
  const insecure = needsHttpConsent(address)
  const ready = address.trim().length > 3 && code.length === LENGTH && (!insecure || http)

  const { width } = useWindowDimensions()
  const side = Math.min(width - space.l * 2, 320)
  const showCamera = camera && scanning && permission?.granted === true
  const showFields = method === 'manual'
  const methods = availableMethods(live)
  const label: Record<PairMethod, string> = {
    nearby: t.pairNearby,
    link: say('Ramu Link'),
    qr: t.pairScanQr,
    manual: t.pairManual,
  }
  const current = nearby.state.hosts.find((host) => host.key === selected?.key)
  const review = reviewSelection(nearby.state.hosts, selected?.key ?? null, selected?.url ?? null)
  // A result matching a saved pairing but advertised at an address that host does not use.
  const savedHost = current?.pairedHostId
    ? computers.find((computer) => computer.id === current.pairedHostId)
    : undefined
  const newAddress =
    !!savedHost &&
    !!selected &&
    savedHost.address.replace(/^https?:\/\//, '') !== selected.url.replace(/^https?:\/\//, '')
  const reconnectHost =
    savedHost?.status !== 'revoked' && !['unsupported', 'insecure', 'mismatch'].includes(moved ?? '')
      ? savedHost
      : undefined
  useEffect(() => setMoved(null), [selected?.key, selected?.url])
  const field = {
    color: c.text,
    fontSize: font.body,
    minHeight: 46,
    paddingVertical: space.s,
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
      <Header modal title={t.pair} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <ScrollView
          ref={scroll}
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
                  disabled={busy}
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

          {method === 'link' ? <LinkHosts /> : null}
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
                      <T size={font.caption} tone="muted" numberOfLines={2}>
                        {host.routes.map((item) => item.url.replace(/^https?:\/\//, '')).join(' · ')}
                      </T>
                      {host.scheme === 'http' || host.pairedHostId ? (
                        <T size={font.caption} tone="muted" numberOfLines={1}>
                          {[host.scheme === 'http' ? t.nearbyPlain : '', host.pairedHostId ? t.nearbyPaired : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </T>
                      ) : null}
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
                  {savedHost ? (
                    <T size={font.control} tone="muted" accessibilityRole="alert">
                      {moved === 'moved'
                        ? fill(t.nearbyMoved, savedHost.name)
                        : moved === 'mismatch'
                          ? fill(t.nearbyMismatch, savedHost.name)
                          : moved === 'unsupported'
                            ? fill(t.nearbyUnsupported, savedHost.name)
                            : moved === 'insecure'
                              ? fill(t.nearbyInsecure, savedHost.name)
                              : moved === 'unreachable'
                                ? t.nearbyUnreachable
                                : newAddress
                                  ? fill(t.nearbyNewAddress, savedHost.name)
                                  : fill(t.nearbyAlready, savedHost.name)}
                    </T>
                  ) : null}
                  <GlassButton
                    primary
                    title={fill(
                      reconnectHost ? t.nearbyReconnect : t.nearbyContinue,
                      reconnectHost?.name ?? current.label,
                    )}
                    disabled={moved === 'checking' || !current.routes.some((route) => route.url === selected.url)}
                    onPress={async () => {
                      if (reconnectHost) {
                        if (pairing.current) return
                        pairing.current = true
                        setMoved('checking')
                        try {
                          const result = await reviewAddress(reconnectHost.id, selected.url)
                          if (!mounted.current) return
                          setMoved(result)
                          if (result !== 'moved' && result !== 'unchanged') return
                          if (result === 'unchanged' && reconnectHost.status !== 'online') retry(reconnectHost.id)
                          select(reconnectHost.id)
                          if (router.canDismiss()) router.dismissAll()
                          else router.replace('/')
                        } catch {
                          if (mounted.current) setMoved('unreachable')
                        } finally {
                          pairing.current = false
                        }
                        return
                      }
                      const choice = pairingFill(current, selected.url)
                      if (!choice) return
                      const typeCode = () => {
                        setAddress(choice.address)
                        setName((existing) => existing || choice.name)
                        setCode('')
                        setOfferScanned(false)
                        setHttp(false)
                        animateLayout()
                        setMethod('manual')
                        setTimeout(() => codeField.current?.focus(), 250)
                      }
                      // Ask the host instead of typing its code: a person there allows it when both show one number.
                      const ask = async () => {
                        if (pairing.current) return
                        pairing.current = true
                        const controller = new AbortController()
                        askAbort.current = controller
                        setAsking({ host: choice.name, code: null })
                        try {
                          await pairByRequest(
                            choice.name,
                            choice.address,
                            needsHttpConsent(choice.address),
                            (number) => {
                              if (mounted.current) setAsking({ host: choice.name, code: number })
                            },
                            controller.signal,
                          )
                          if (!mounted.current) return
                          if (router.canDismiss()) router.dismissAll()
                          else router.replace('/')
                        } catch (error) {
                          if (!mounted.current || controller.signal.aborted) return
                          setAsking(null)
                          // Whatever stopped the request, the code form is filled in and ready as the next step.
                          if (!(error instanceof PairRequestUnsupported))
                            Alert.alert(t.pairFailed, error instanceof Error ? error.message : String(error))
                          typeCode()
                        } finally {
                          pairing.current = false
                          if (askAbort.current === controller) askAbort.current = null
                        }
                      }
                      if (!needsHttpConsent(choice.address)) return void ask()
                      // The same consent as a typed address: this host is reached without encryption.
                      Alert.alert(t.pairHttpAllow, t.pairHttpNotice, [
                        { text: t.cancel, style: 'cancel' },
                        { text: fill(t.nearbyContinue, choice.name), onPress: () => void ask() },
                      ])
                    }}
                  />
                </View>
              ) : null}
              {asking ? (
                <Card style={{ padding: space.m, gap: space.s, alignItems: 'center' }}>
                  {asking.code ? (
                    <>
                      <T tone="soft" style={{ textAlign: 'center' }}>
                        {fill(t.pairAskConfirm, asking.host)}
                      </T>
                      <T weight="600" style={{ fontSize: 34, letterSpacing: 4, fontVariant: ['tabular-nums'] }}>
                        {asking.code}
                      </T>
                    </>
                  ) : (
                    <T tone="soft">{fill(t.pairAsking, asking.host)}</T>
                  )}
                  <GlassButton
                    title={t.cancel}
                    onPress={() => {
                      askAbort.current?.abort()
                      setAsking(null)
                    }}
                  />
                </Card>
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
                          setOfferScanned(true)
                          Keyboard.dismiss()
                          animateLayout()
                          scroll.current?.scrollTo({ y: 0, animated: false })
                          setScanning(false)
                          // The scanned address and code are shown for review in the manual fields.
                          setMethod('manual')
                        } catch (error) {
                          setScanning(false)
                          Alert.alert(t.pairScanFailed, error instanceof Error ? error.message : String(error))
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
              {offerScanned ? (
                <View style={{ gap: space.s }}>
                  <T accessibilityLiveRegion="polite" weight="600">
                    {t.pairScanned}
                  </T>
                  <T size={font.control} tone="muted">
                    {t.pairReviewHint}
                  </T>
                  <GlassButton title={t.pairScanAgain} disabled={busy} onPress={() => choose('qr')} />
                </View>
              ) : null}
              <View style={{ gap: space.s }}>
                <T size={font.control} weight="500" tone="soft">
                  {t.pairAddress}
                </T>
                <TextInput
                  value={address}
                  editable={!busy}
                  accessibilityLabel={t.pairAddress}
                  onChangeText={(value) => {
                    setAddress(value)
                    setHttp(false)
                    setOfferScanned(false)
                  }}
                  placeholder="https://my-mac.local:7421"
                  placeholderTextColor={c.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={field}
                />
                <T size={font.caption} tone="muted">
                  {t.pairAddressHint}
                </T>
              </View>

              <View style={{ gap: space.s }}>
                <T size={font.control} weight="500" tone="soft">
                  {t.pairCode}
                </T>
                <TextInput
                  ref={codeField}
                  editable={!busy}
                  accessibilityLabel={t.pairCode}
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
                  {t.pairName}
                </T>
                <TextInput
                  editable={!busy}
                  accessibilityLabel={t.pairName}
                  value={name}
                  onChangeText={setName}
                  placeholder={t.pairNameHint}
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
                      {t.pairHttpNotice}
                    </T>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <T size={font.control} weight="500" style={{ flex: 1 }}>
                      {t.pairHttpAllow}
                    </T>
                    <Toggle
                      accessibilityLabel={t.pairHttpAllow}
                      disabled={busy}
                      value={http}
                      onValueChange={(value) => {
                        if (!pairing.current) setHttp(value)
                      }}
                    />
                  </View>
                </Card>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {showFields ? (
          <View
            style={{
              paddingHorizontal: space.l,
              paddingTop: space.m,
              paddingBottom: Math.max(insets.bottom, space.m),
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.lineStrong,
              backgroundColor: c.canvas,
            }}
          >
            <GlassButton
              primary
              style={{ alignSelf: 'stretch' }}
              title={busy ? t.pairBusy : t.pairAction}
              disabled={!ready || busy}
              onPress={async () => {
                if (!ready || pairing.current) return
                pairing.current = true
                Keyboard.dismiss()
                setBusy(true)
                try {
                  await pair(name.trim(), address.trim(), code, http)
                  if (router.canDismiss()) router.dismissAll()
                  else router.replace('/')
                } catch (error) {
                  Alert.alert(t.pairFailed, error instanceof Error ? error.message : String(error))
                } finally {
                  pairing.current = false
                  setBusy(false)
                }
              }}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}
