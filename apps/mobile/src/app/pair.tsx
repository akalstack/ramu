import { useEffect, useRef, useState } from 'react'
import {
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
import { CameraOff, QrCode, ShieldAlert } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { GlassButton, Header, Screen, useSheetKeyboardOffset, PageScrollView as ScrollView } from '../components/Screen'
import { Card, T, Toggle, tap } from '../components/ui'
import { Disclosure, animateLayout } from '../components/Motion'

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
  // The camera is the first thing on the page: it opens as soon as the screen does (native only).
  const live = Platform.OS !== 'web'
  const [scanning, setScanning] = useState(live)
  const [manual, setManual] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const asked = useRef(false)
  const scanned = useRef(false)
  const codeField = useRef<TextInput>(null)
  useEffect(() => {
    if (!live || !permission || permission.granted || !permission.canAskAgain || asked.current) return
    asked.current = true
    void requestPermission()
  }, [live, permission, requestPermission])
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
    } catch (error) {
      Alert.alert('Cannot use this link', error instanceof Error ? error.message : String(error))
    }
  }, [params.url, params.code, params.exp, params.name])
  const insecure = needsHttpConsent(address)
  const ready = address.trim().length > 3 && code.length === LENGTH && (!insecure || http)

  const { width } = useWindowDimensions()
  const side = Math.min(width - space.l * 2, 320)
  const showCamera = live && scanning && permission?.granted === true
  const showFields = manual || Boolean(address || code)
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
                  Camera access is off. Allow it to scan the QR code, or enter the details manually.
                </T>
                <GlassButton
                  title={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
                  onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
                />
              </View>
            ) : live && permission ? (
              <View style={{ alignItems: 'center', gap: space.m, padding: space.xl }}>
                <QrCode size={30} color={c.accent} strokeWidth={1.6} />
                <T weight="600">{address ? 'QR code scanned' : 'Camera paused'}</T>
                <GlassButton title="Scan again" onPress={rescan} />
              </View>
            ) : (
              <QrCode size={30} color={c.placeholder} strokeWidth={1.6} />
            )}
          </View>
          <T size={font.control} tone="muted" style={{ textAlign: 'center', lineHeight: 19, maxWidth: side }}>
            On your host open Ramu → Settings → Remote access → Pair a device, then point the camera at its QR code.
          </T>

          {showFields ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tap()
                animateLayout()
                setManual(true)
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.s }}
            >
              <T weight="500" tone="accent">
                Enter details manually
              </T>
              <Disclosure open={false} size={15} color={c.accent} />
            </Pressable>
          )}

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
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
