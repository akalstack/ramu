import { useEffect } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { Monitor, Radar, ScanQrCode, UserRound } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { WELCOME_DISMISSED } from '../runtime/pairingModel'
import { GlassButton, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { ReadableColumn } from '../components/ReadableColumn'
import { AnimatedMark } from '../components/AnimatedMark'
import { Button, T, tap } from '../components/ui'
import { useT } from '../i18n'

/**
 * What a phone with no host opens to: the computer runs the agents and this phone is its remote, so the one thing to do
 * is pair. Scanning the computer's code comes first; nearby discovery, the Ramu account and typing the details follow.
 * It never traps anyone: looking around first is always there, and it closes once a host is paired.
 */
export default function Welcome() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const navigation = useNavigation()
  const store = useStore()
  const native = Platform.OS !== 'web'
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  // A host added another way (through the account, or from a link) ends the reason for this screen.
  const paired = store.computers.length > 0
  useEffect(() => {
    if (paired && navigation.isFocused()) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closes once when the first host arrives
  }, [paired])
  const pairWith = (method: 'qr' | 'nearby' | 'manual') => router.push({ pathname: '/pair', params: { method } })
  return (
    <Screen bg="canvas">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl }}
      >
        <ReadableColumn style={{ paddingHorizontal: space.l, gap: space.xl, alignItems: 'stretch' }}>
          <View style={{ alignItems: 'center', gap: space.m }}>
            <AnimatedMark size={64} />
            <T accessibilityRole="header" size={28} weight="700" style={{ textAlign: 'center', letterSpacing: -0.4 }}>
              {t.welcomeTitle}
            </T>
            <T tone="soft" style={{ textAlign: 'center', lineHeight: 22, maxWidth: 360 }}>
              {t.welcomeBody}
            </T>
          </View>

          <View style={{ gap: space.s }}>
            {native ? (
              <GlassButton primary icon={ScanQrCode} title={t.welcomeScan} onPress={() => pairWith('qr')} />
            ) : null}
            {native ? <GlassButton icon={Radar} title={t.welcomeNearby} onPress={() => pairWith('nearby')} /> : null}
            <GlassButton
              icon={UserRound}
              title={t.welcomeAccount}
              onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'account' } })}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tap()
                pairWith('manual')
              }}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <T size={font.control} weight="600" tone="accent">
                {t.welcomeManual}
              </T>
            </Pressable>
          </View>

          <View
            style={{
              flexDirection: 'row',
              gap: space.s,
              alignItems: 'flex-start',
              padding: space.m,
              borderRadius: radius.m,
              backgroundColor: c.fill,
            }}
          >
            <Monitor size={16} color={c.muted} style={{ marginTop: 2 }} />
            <T size={font.control} tone="muted" style={{ flex: 1, lineHeight: 19 }}>
              {t.welcomeWhere}
            </T>
          </View>

          <Button
            kind="ghost"
            title={t.welcomeLater}
            onPress={() => {
              store.setDraft(WELCOME_DISMISSED, 'yes')
              close()
            }}
          />
        </ReadableColumn>
      </ScrollView>
    </Screen>
  )
}
