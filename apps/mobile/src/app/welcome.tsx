import { useEffect, useState, type ReactNode } from 'react'
import { BackHandler, Linking, Platform, Pressable, Share, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bell, ChevronLeft, Globe, Monitor, Radar, ScanQrCode, Send, UserRound } from 'lucide-react-native'
import type { NetworkStatus } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { WELCOME_DISMISSED } from '../runtime/pairingModel'
import {
  ALTERNATIVE_COPY,
  ONBOARDING_STEP,
  ONBOARDING_STEPS,
  connectedRoute,
  nextStep,
  previousStep,
  reachPlan,
  resumeStep,
  type OnboardingStep,
  type ReachPlan,
} from '../runtime/onboardingModel'
import * as account from '../runtime/account'
import { showError } from '../runtime/toast'
import { GlassButton, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { ReadableColumn } from '../components/ReadableColumn'
import { AnimatedMark } from '../components/AnimatedMark'
import { RequestPermission } from '../components/DevicePermissions'
import { Button, Card, Segmented, T, tap } from '../components/ui'
import { fill, useT, type Strings } from '../i18n'

const DOWNLOAD_URL = 'https://getramu.dev/download'
const OWN_RELAY_DOCS = 'https://github.com/akalstack/ramu/blob/main/docs/guide/remote-hosts.md#ramu-link'

/**
 * A phone's first run, one step per screen: what Ramu is, connecting to the computer, how it is reached (with Ramu Link
 * for away from home), notifications, and done. Every step has a default, so the main button alone finishes it. The
 * step is saved, so a reopened app resumes there, and Skip always leaves to look around first.
 */
export default function Welcome() {
  const t = useT()
  const router = useRouter()
  const navigation = useNavigation()
  const store = useStore()
  const insets = useSafeAreaInsets()
  const { c } = useTheme()
  const paired = store.computers.length > 0
  const [step, setStepState] = useState<OnboardingStep>(() =>
    resumeStep(store.drafts[ONBOARDING_STEP], store.computers.length),
  )
  const setStep = (next: OnboardingStep) => {
    tap()
    setStepState(next)
    store.setDraft(ONBOARDING_STEP, next)
  }
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  const finish = () => {
    store.setDraft(ONBOARDING_STEP, '')
    store.setDraft(WELCOME_DISMISSED, 'yes')
    close()
  }
  // A host added another way (the pair screen, the account, or a link) moves the steps on to Connected.
  useEffect(() => {
    if (paired && (step === 'welcome' || step === 'connect')) setStep('connected')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moves on once, when the first host arrives
  }, [paired])
  const back = previousStep(step)
  useEffect(() => {
    if (!navigation.isFocused()) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!back) return false
      setStep(back)
      return true
    })
    return () => subscription.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bound per step
  }, [back])
  const index = ONBOARDING_STEPS.indexOf(step)
  const host = store.computers.find((computer) => computer.id === store.selected) ?? store.computers[0]
  return (
    <Screen bg="canvas">
      <View
        style={{
          paddingTop: insets.top + space.s,
          paddingHorizontal: space.m,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 44 + insets.top,
        }}
      >
        <View style={{ width: 88, alignItems: 'flex-start' }}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.onboardBack}
              hitSlop={8}
              onPress={() => setStep(back)}
              style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
            >
              <ChevronLeft size={24} color={c.text} />
            </Pressable>
          ) : null}
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={fill(t.onboardStepOf, index + 1, ONBOARDING_STEPS.length)}
          style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          {ONBOARDING_STEPS.map((entry, at) => (
            <Dot key={entry} active={at === index} done={at < index} />
          ))}
        </View>
        <View style={{ width: 88, alignItems: 'flex-end' }}>
          {step !== 'done' ? (
            <Pressable
              accessibilityRole="button"
              onPress={finish}
              hitSlop={8}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <T size={font.control} weight="600" tone="accent">
                {paired ? t.onboardSkip : t.welcomeLater}
              </T>
            </Pressable>
          ) : null}
        </View>
      </View>
      {step === 'welcome' ? <WelcomeStep t={t} onNext={() => setStep(nextStep(step)!)} /> : null}
      {step === 'connect' ? <ConnectStep t={t} /> : null}
      {step === 'connected' && host ? (
        <ConnectedStep
          t={t}
          computerId={host.id}
          name={host.name}
          address={host.address}
          onNext={() => setStep('notifications')}
        />
      ) : null}
      {step === 'notifications' ? <NotificationsStep t={t} onNext={() => setStep('done')} /> : null}
      {step === 'done' ? (
        <DoneStep
          t={t}
          name={host?.name ?? ''}
          onOpen={() => {
            if (host) store.select(host.id)
            finish()
          }}
        />
      ) : null}
    </Screen>
  )
}

function Dot({ active, done }: { active: boolean; done: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        width: active ? 18 : 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: active || done ? c.accent : c.line,
      }}
    />
  )
}

/** One step: its content scrolls in the middle and its main actions sit at the bottom, within reach of a thumb. */
function StepLayout({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: space.l }}
      >
        <ReadableColumn style={{ paddingHorizontal: space.l, gap: space.l, alignItems: 'stretch' }}>
          {children}
        </ReadableColumn>
      </ScrollView>
      <ReadableColumn
        style={{
          paddingHorizontal: space.l,
          paddingTop: space.s,
          paddingBottom: insets.bottom + space.m,
          gap: space.s,
        }}
      >
        {actions}
      </ReadableColumn>
    </View>
  )
}

function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space.m }}>
      <T accessibilityRole="header" size={28} weight="700" style={{ textAlign: 'center', letterSpacing: -0.4 }}>
        {title}
      </T>
      {body ? (
        <T tone="soft" style={{ textAlign: 'center', lineHeight: 22, maxWidth: 360 }}>
          {body}
        </T>
      ) : null}
    </View>
  )
}

function WelcomeStep({ t, onNext }: { t: Strings; onNext: () => void }) {
  const store = useStore()
  return (
    <StepLayout actions={<GlassButton primary title={t.onboardStart} onPress={onNext} />}>
      <View style={{ alignItems: 'center' }}>
        <AnimatedMark size={72} />
      </View>
      <Heading title={t.onboardWelcomeTitle} body={t.welcomeBody} />
      <View style={{ gap: space.xs }}>
        <T size={font.control} tone="muted" style={{ textAlign: 'center' }}>
          {t.onboardLanguage}
        </T>
        <Segmented
          value={store.language}
          onChange={store.setLanguage}
          options={[
            { key: 'en', label: 'English' },
            { key: 'id', label: 'Bahasa Indonesia' },
          ]}
        />
      </View>
    </StepLayout>
  )
}

function ConnectStep({ t }: { t: Strings }) {
  const router = useRouter()
  const native = Platform.OS !== 'web'
  const pairWith = (method: 'qr' | 'nearby' | 'manual') =>
    router.push({ pathname: '/pair', params: { method, from: 'onboarding' } })
  return (
    <StepLayout
      actions={
        <>
          {native ? (
            <GlassButton primary icon={ScanQrCode} title={t.welcomeScan} onPress={() => pairWith('qr')} />
          ) : null}
          <GlassButton
            icon={UserRound}
            title={t.welcomeAccount}
            onPress={() =>
              router.push({ pathname: '/settings/[section]', params: { section: 'account', from: 'onboarding' } })
            }
          />
          {native ? <GlassButton icon={Radar} title={t.welcomeNearby} onPress={() => pairWith('nearby')} /> : null}
          <Button kind="ghost" title={t.welcomeManual} onPress={() => pairWith('manual')} />
        </>
      }
    >
      <Heading title={t.welcomeTitle} />
      <Note icon={ScanQrCode}>{t.welcomeWhere}</Note>
      <Note icon={UserRound}>{t.welcomeAccountHint}</Note>
      <View style={{ gap: space.xs, alignItems: 'center' }}>
        <T size={font.control} tone="muted">
          {t.onboardNoComputer}
        </T>
        <Button
          kind="secondary"
          title={t.onboardSendDownload}
          onPress={() =>
            void Share.share({ message: fill(t.onboardShareMessage, DOWNLOAD_URL), url: DOWNLOAD_URL }).catch(() => {})
          }
        />
      </View>
    </StepLayout>
  )
}

function Note({ icon: Icon, children }: { icon: typeof Monitor; children: ReactNode }) {
  const { c } = useTheme()
  return (
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
      <Icon size={16} color={c.muted} style={{ marginTop: 2 }} />
      <T size={font.control} tone="muted" style={{ flex: 1, lineHeight: 19 }}>
        {children}
      </T>
    </View>
  )
}

const ROUTE_COPY = {
  link: 'onboardThroughLink',
  LAN: 'onboardThroughLan',
  VPN: 'onboardThroughVpn',
  Internet: 'onboardThroughInternet',
} as const

const ALTERNATIVE_TEXT = {
  tailscale: 'onboardAltTailscale',
  installTailscale: 'onboardAltInstallTailscale',
  ownRelay: 'onboardAltOwnRelay',
  quick: 'onboardAltQuick',
  ngrok: 'onboardAltNgrok',
  link: 'onboardOnComputer',
} as const

const BLOCKED_TEXT = {
  suspended: 'onboardLinkSuspended',
  taken: 'onboardLinkTaken',
  unavailable: 'onboardLinkUnavailable',
} as const

function ConnectedStep({
  t,
  computerId,
  name,
  address,
  onNext,
}: {
  t: Strings
  computerId: string
  name: string
  address: string
  onNext: () => void
}) {
  const store = useStore()
  const router = useRouter()
  const [tunnel, setTunnel] = useState<NetworkStatus['tunnel'] | null | undefined>(undefined)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [turningOn, setTurningOn] = useState(false)
  useEffect(() => {
    let live = true
    void account.accountUser().then(
      (user) => live && setSignedIn(!!user),
      () => live && setSignedIn(false),
    )
    // A host that does not share its tunnel with this phone is set up on the computer.
    void store.invoke(computerId, 'network.link').then(
      (status) => live && setTunnel(status.tunnel ?? null),
      () => live && setTunnel(null),
    )
    return () => {
      live = false
    }
  }, [computerId, store])
  const route = connectedRoute(address)
  const plan: ReachPlan | null = tunnel === undefined ? null : reachPlan(address, tunnel, !!signedIn)
  const turnOn = async () => {
    setTurningOn(true)
    try {
      const status = await store.invoke(computerId, 'network.useLink')
      setTunnel(status.tunnel ?? null)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    } finally {
      setTurningOn(false)
    }
  }
  return (
    <StepLayout
      actions={
        <>
          {plan?.kind === 'offer-link' ? (
            <GlassButton
              primary
              icon={Globe}
              title={turningOn ? t.onboardLinkStarting : t.onboardReachAnywhere}
              disabled={turningOn || !store.mayUse(computerId, 'settings')}
              onPress={() => void turnOn()}
            />
          ) : null}
          <GlassButton primary={plan?.kind !== 'offer-link'} title={t.onboardContinue} onPress={onNext} />
        </>
      }
    >
      <Heading title={fill(t.onboardConnectedTitle, name)} body={route ? t[ROUTE_COPY[route]] : undefined} />
      {plan && plan.kind !== 'reachable' ? (
        <Card style={{ padding: space.m, gap: space.s }}>
          <T weight="600">{t.onboardAwayTitle}</T>
          <ReachCopy t={t} plan={plan} />
          {plan.kind === 'offer-link' && !store.mayUse(computerId, 'settings') ? (
            <RequestPermission computerId={computerId} permission="settings" />
          ) : null}
          {(plan.kind === 'full' || plan.kind === 'blocked') && plan.alternative === 'own-relay' ? (
            <Button kind="secondary" title={t.onboardHowTo} onPress={() => void Linking.openURL(OWN_RELAY_DOCS)} />
          ) : null}
        </Card>
      ) : null}
      {signedIn === false ? (
        <Card style={{ padding: space.m, gap: space.s }}>
          <T size={font.control} tone="muted">
            {t.onboardAlsoSignInHint}
          </T>
          <Button
            kind="secondary"
            title={t.onboardAlsoSignIn}
            onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'account' } })}
          />
        </Card>
      ) : null}
    </StepLayout>
  )
}

function ReachCopy({ t, plan }: { t: Strings; plan: ReachPlan }) {
  if (plan.kind === 'link-active')
    return <T tone="soft">{plan.hostname ? fill(t.onboardLinkOn, plan.hostname) : t.onboardLinkOnNoName}</T>
  if (plan.kind === 'offer-link') return <T tone="soft">{t.onboardOfferLink}</T>
  if (plan.kind === 'on-computer') return <T tone="soft">{t.onboardOnComputer}</T>
  if (plan.kind !== 'full' && plan.kind !== 'blocked') return null
  const alternative = plan.alternative ? t[ALTERNATIVE_TEXT[ALTERNATIVE_COPY[plan.alternative]]] : null
  return (
    <View style={{ gap: space.s }}>
      <T tone="soft">
        {plan.kind === 'full' ? `${t.onboardLinkFull}. ${t.onboardLinkWaitlist}` : t[BLOCKED_TEXT[plan.reason]]}
      </T>
      {alternative ? (
        <>
          <T size={font.control} tone="muted">
            {t.onboardMeanwhile}
          </T>
          <T>{alternative}</T>
        </>
      ) : null}
    </View>
  )
}

function NotificationsStep({ t, onNext }: { t: Strings; onNext: () => void }) {
  const store = useStore()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  return (
    <StepLayout
      actions={
        <>
          <GlassButton
            primary
            icon={Bell}
            title={t.onboardNotifyAllow}
            disabled={busy}
            onPress={() => {
              setBusy(true)
              void store
                .enablePush()
                .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)))
                .finally(() => {
                  setBusy(false)
                  onNext()
                })
            }}
          />
          <Button kind="ghost" title={t.onboardNotNow} onPress={onNext} />
        </>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <Bell size={48} color={c.accent} />
      </View>
      <Heading title={t.onboardNotifyTitle} body={t.onboardNotifyBody} />
    </StepLayout>
  )
}

function DoneStep({ t, name, onOpen }: { t: Strings; name: string; onOpen: () => void }) {
  return (
    <StepLayout actions={<GlassButton primary icon={Send} title={t.onboardOpenThreads} onPress={onOpen} />}>
      <View style={{ alignItems: 'center' }}>
        <AnimatedMark size={64} />
      </View>
      <Heading title={t.onboardDoneTitle} body={fill(t.onboardDoneBody, name)} />
    </StepLayout>
  )
}
