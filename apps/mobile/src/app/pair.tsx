import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Alert, Pressable, Switch, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { needsHttpConsent } from '../runtime/transport'
import { decodePairQr, parsePairInput } from '@ramu/contracts'
import { QrCode, ShieldAlert } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { GlassButton, Header, Screen, useSheetKeyboardOffset, PageScrollView as ScrollView } from '../components/Screen'
import { Card, T } from '../components/ui'

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
  const [scanning, setScanning] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const scanned = useRef(false)
  const codeField = useRef<TextInput>(null)
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

  const field = {
    color: c.text,
    fontSize: font.body,
    height: 46,
    paddingHorizontal: space.m,
    borderRadius: radius.s + 2,
    backgroundColor: c.fill,
  } as const

  return (
    <Screen bg="canvas">
      <Header modal title="Pair a computer" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, gap: space.l }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={async () => {
              if (permission?.granted || (await requestPermission()).granted) {
                scanned.current = false
                setScanning(true)
              }
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: radius.m,
                  backgroundColor: c.accentWash,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <QrCode size={28} color={c.accent} strokeWidth={1.6} />
              </View>
              <T weight="600">Scan the QR code</T>
              <T
                size={font.control}
                tone="muted"
                style={{ textAlign: 'center', paddingHorizontal: space.xl, lineHeight: 19 }}
              >
                On your computer open Ramu → Settings → Remote access → Pair a device.
              </T>
            </Card>
          </Pressable>

          {scanning ? (
            <View style={{ height: 280 }}>
              <CameraView
                style={{ flex: 1 }}
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
              <GlassButton title="Cancel scan" onPress={() => setScanning(false)} />
            </View>
          ) : null}
          <T
            size={font.caption}
            weight="600"
            tone="muted"
            style={{ textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 }}
          >
            or enter it manually
          </T>

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
              Name (optional)
            </T>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Defaults to the computer's own name"
              placeholderTextColor={c.placeholder}
              style={field}
            />
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

          {insecure ? (
            <Card style={{ padding: space.m, gap: space.m, backgroundColor: c.warnWash }}>
              <View style={{ flexDirection: 'row', gap: space.s }}>
                <ShieldAlert size={16} color={c.warn} />
                <T size={font.control} tone="soft" style={{ flex: 1, lineHeight: 19 }}>
                  Plain HTTP sends your device token unencrypted. Only allow it on a network you trust (home LAN or
                  VPN).
                </T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <T size={font.control} weight="500" style={{ flex: 1 }}>
                  Allow HTTP for this computer
                </T>
                <Switch value={http} onValueChange={setHttp} trackColor={{ true: c.primary }} />
              </View>
            </Card>
          ) : null}

          <GlassButton
            primary
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
