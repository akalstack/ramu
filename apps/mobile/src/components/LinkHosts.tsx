// The pairing screen's Ramu Link tab: sign in with the account your hosts use, then choose one. The host's person allows
// it after both screens show the same six-digit number, exactly as for a nearby host.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Linking, Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Monitor } from 'lucide-react-native'
import type { LinkHost } from '@ramu/shared/link/account'
import { planSummary } from '@ramu/shared/link/plan'
import { DEFAULT_LINK_SERVICE, linkAddress, type LinkPlanStatus } from '@ramu/shared/link/protocol'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import {
  accountHosts,
  accountPlan,
  cancelLinkSignIn,
  plusCheckoutUrl,
  setLinkService,
  signInToLink,
  signOutOfLink,
  useLinkAccount,
} from '../runtime/link'
import { GlassButton } from './Screen'
import { Card, T, tap } from './ui'

export function LinkHosts() {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const { pairByRequest, computers } = useStore()
  const link = useLinkAccount()
  const [service, setService] = useState(link.service ?? '')
  const [hosts, setHosts] = useState<LinkHost[] | null>(null)
  const [plan, setPlan] = useState<LinkPlanStatus | null>(null)
  // With a hosted service, typing another address is an advanced step.
  const [showService, setShowService] = useState(
    DEFAULT_LINK_SERVICE === null || (link.service !== null && link.service !== DEFAULT_LINK_SERVICE),
  )
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<{ name: string; code: string | null } | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const refresh = useCallback(() => {
    if (!link.account) {
      setPlan(null)
      return setHosts(null)
    }
    accountHosts().then(setHosts, (error: unknown) => {
      setHosts([])
      Alert.alert(say('Ramu Link'), error instanceof Error ? error.message : String(error))
    })
    accountPlan().then(setPlan, () => {})
  }, [link.account, say])
  useEffect(refresh, [refresh])
  // Coming back from checkout in the browser is when Plus may have arrived.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && refresh())
    return () => subscription.remove()
  }, [refresh])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      Alert.alert(say('Ramu Link'), error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const connect = async (host: LinkHost) => {
    tap()
    const controller = new AbortController()
    abort.current = controller
    setAsking({ name: host.name, code: null })
    try {
      await pairByRequest(
        host.name,
        linkAddress(host.hostId),
        false,
        (code) => setAsking({ name: host.name, code }),
        controller.signal,
      )
      if (router.canDismiss()) router.dismissAll()
      else router.replace('/')
    } catch (error) {
      if (controller.signal.aborted) return
      setAsking(null)
      Alert.alert(say('Could not connect'), error instanceof Error ? error.message : String(error))
    }
  }
  const field = {
    color: c.text,
    fontSize: font.body,
    minHeight: 46,
    paddingHorizontal: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  } as const

  if (asking)
    return (
      <Card style={{ padding: space.m, gap: space.s, alignItems: 'center', alignSelf: 'stretch' }}>
        {asking.code ? (
          <>
            <T tone="soft" style={{ textAlign: 'center' }}>
              {say('Allow this phone on {0} if it shows this number', { 0: asking.name })}
            </T>
            <T weight="600" style={{ fontSize: 34, letterSpacing: 4, fontVariant: ['tabular-nums'] }}>
              {asking.code}
            </T>
          </>
        ) : (
          <T tone="soft">{say('Asking {0}…', { 0: asking.name })}</T>
        )}
        <GlassButton
          title={say('Cancel')}
          onPress={() => {
            abort.current?.abort()
            setAsking(null)
          }}
        />
      </Card>
    )

  if (!link.account)
    return (
      <View style={{ alignSelf: 'stretch', gap: space.m }}>
        <T tone="soft">
          {say(
            'Sign in with the Google or GitHub account your hosts use for Ramu Link. They appear here and connect from anywhere, end-to-end encrypted.',
          )}
        </T>
        {link.signIn ? (
          <Card style={{ padding: space.m, gap: space.s, alignItems: 'center' }}>
            <T tone="soft">{say('Approve this code on the sign-in page')}</T>
            <T weight="600" style={{ fontSize: 28, letterSpacing: 3 }}>
              {link.signIn.userCode}
            </T>
            <GlassButton title={say('Open sign-in page')} onPress={() => void Linking.openURL(link.signIn!.url)} />
            <GlassButton title={say('Cancel')} onPress={cancelLinkSignIn} />
          </Card>
        ) : (
          <>
            {!showService && <GlassButton title={say('Use my own service…')} onPress={() => setShowService(true)} />}
            {showService && (
              <TextInput
                accessibilityLabel={say('Service')}
                placeholder="https://link.example.com"
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={service}
                onChangeText={setService}
                style={field}
              />
            )}
            <GlassButton
              primary
              title={say('Sign in…')}
              disabled={busy || !(service.trim() || DEFAULT_LINK_SERVICE)}
              onPress={() =>
                void run(async () => {
                  if (showService && service.trim() !== (link.service ?? '')) setLinkService(service.trim())
                  await Linking.openURL(await signInToLink())
                })
              }
            />
          </>
        )}
        {link.error ? (
          <T size={font.control} tone="warn" accessibilityRole="alert">
            {link.error}
          </T>
        ) : null}
      </View>
    )

  const paired = new Set(computers.map((computer) => computer.hostId).filter(Boolean))
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s }}>
      <T size={font.caption} tone="muted">
        {say('Signed in as {0}', { 0: link.account.email })}
      </T>
      {plan ? <PlanCard plan={plan} busy={busy} run={run} /> : null}
      {hosts?.length
        ? hosts.map((host) => {
            const already = paired.has(host.hostId)
            return (
              <Pressable
                key={host.hostId}
                accessibilityRole="button"
                accessibilityState={{ disabled: already || !host.online }}
                disabled={already || !host.online || busy}
                onPress={() => void connect(host)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.m,
                  padding: space.m,
                  minHeight: 56,
                  borderRadius: radius.m,
                  backgroundColor: c.fill,
                  opacity: already || !host.online ? 0.6 : 1,
                }}
              >
                <Monitor size={18} color={c.soft} />
                <View style={{ flex: 1 }}>
                  <T weight="600" numberOfLines={1}>
                    {host.name}
                  </T>
                  <T size={font.caption} tone="muted">
                    {host.sharedBy ? `${say('Shared by {0}', { 0: host.sharedBy })} · ` : ''}
                    {already ? say('Already connected') : host.online ? say('Online') : say('Offline')}
                  </T>
                </View>
              </Pressable>
            )
          })
        : hosts && (
            <T tone="soft">
              {say(
                'No other hosts are linked to this account. On a host, turn on Ramu Link in Remote access or run ramu up.',
              )}
            </T>
          )}
      <GlassButton title={say('Refresh')} disabled={busy} onPress={refresh} />
      <GlassButton title={say('Sign out')} disabled={busy} onPress={() => void run(signOutOfLink)} />
    </View>
  )
}

/** The same plan line as the desktop's Settings, and Get Plus, which opens Paddle's checkout in the browser. */
function PlanCard({
  plan,
  busy,
  run,
}: {
  plan: LinkPlanStatus
  busy: boolean
  run: (work: () => Promise<unknown>) => Promise<void>
}) {
  const say = useSay()
  const summary = planSummary(plan)
  const hosts =
    plan.hostLimit === null
      ? say('{0} hosts linked', { 0: plan.hosts })
      : say('{0} of {1} hosts', { 0: plan.hosts, 1: plan.hostLimit })
  const line =
    plan.plan === 'free'
      ? [
          say('Free'),
          hosts,
          say('{0} of {1} relayed hours this month', { 0: summary.hoursUsed, 1: summary.hoursLimit ?? 0 }),
        ]
      : [say('Plus'), hosts]
  const checkout = (interval: 'year' | 'month') =>
    void run(async () => {
      await Linking.openURL(await plusCheckoutUrl(interval))
    })
  return (
    <Card style={{ padding: space.m, gap: space.s }}>
      <T weight="600">{say('Plan')}</T>
      <T size={font.control} tone="soft">
        {line.join(' · ')}
      </T>
      {summary.outOfHours ? (
        <T size={font.control} tone="warn">
          {say('Ramu Link takes no new connections until the 1st; this host’s own network still works.')}
        </T>
      ) : null}
      {summary.canGetPlus ? (
        <>
          <GlassButton primary title={say('Get Plus yearly')} disabled={busy} onPress={() => checkout('year')} />
          <GlassButton title={say('Monthly')} disabled={busy} onPress={() => checkout('month')} />
        </>
      ) : null}
    </Card>
  )
}
