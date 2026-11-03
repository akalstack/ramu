import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { compatibilitySummary } from '@ramu/shared/providers/compatibility'
import { compatibilityPlan } from '@ramu/shared/providers/compatibilityPlan'
import { planName, providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, Card, Divider, SectionLabel, T } from './ui'
import { Hint } from './SettingRows'

/** Last result per host, so an unreachable host still shows what was known, marked as stale. */
const lastKnown = new Map<string, ProviderStatus[]>()

/**
 * Provider versions and runtime compatibility as the selected host reports them. Every probe and update runs on that host;
 * the phone never inspects itself. Path changes and Ramu updates stay on the host, so they appear as guidance.
 */
export function ProviderCompatibility({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  const online = store.isOnline(hostId)
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(() => lastKnown.get(hostId) ?? null)
  const [stale, setStale] = useState(!online)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const runtime = useRef(store)
  runtime.current = store

  const load = useCallback(
    async (refresh: boolean) => {
      const mine = ++generation.current
      setError('')
      try {
        const result = await runtime.current.invoke(hostId, 'providers.status', undefined, false, refresh)
        // A late answer for a previous host selection or an older request is dropped.
        if (mine !== generation.current) return
        lastKnown.set(hostId, result)
        setStatuses(result)
        setStale(false)
      } catch (reason) {
        if (mine !== generation.current) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setStale(true)
        setError(message)
      } finally {
        if (mine === generation.current) setBusy(null)
      }
    },
    [hostId],
  )
  useEffect(() => {
    setStatuses(lastKnown.get(hostId) ?? null)
    setStale(!online)
    if (online) void load(false)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++generation.current
    }
  }, [hostId, online, load])

  const update = async (provider: ProviderStatus['provider']) => {
    setBusy(provider)
    try {
      await runtime.current.invoke(hostId, 'providers.update', provider)
    } catch (reason) {
      Alert.alert(t('Update'), reason instanceof Error ? reason.message : String(reason))
    }
    await load(true)
  }
  const checkAgain = (provider: string) => {
    setBusy(provider)
    void load(true)
  }

  const shown = (statuses ?? []).filter((status) => status.installed && status.enabled)
  return (
    <>
      <SectionLabel>{t('Runtime compatibility')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {!statuses ? (
          <View style={{ padding: space.m }}>
            {online && !error ? (
              <ActivityIndicator color={c.accent} />
            ) : (
              <T size={font.control} tone="muted">
                {error || t('Reconnect to check provider compatibility.')}
              </T>
            )}
          </View>
        ) : shown.length ? (
          shown.map((status, index) => {
            const result = status.compatibility
            // A custom executable path is set on the host; its own status already withholds updates for it.
            const plan = compatibilityPlan(status, { customBinary: false, canUpdate: online && !status.updateError })
            const bad = result?.status === 'incompatible'
            return (
              <View key={status.provider}>
                {index ? <Divider inset={space.l} /> : null}
                <View style={{ padding: space.m, gap: space.s }}>
                  <View style={{ flexDirection: 'row', gap: space.s }}>
                    <T weight="600" style={{ flex: 1 }}>
                      {providerName(status.provider)}
                    </T>
                    <T tone="muted" size={font.caption}>
                      {status.version ?? ''}
                    </T>
                  </View>
                  {/* Each signed-in login's plan as the provider reports it now, so an upgrade shows here too. */}
                  {Object.entries(status.signIn ?? {})
                    .filter(([, login]) => login.signedIn && login.plan)
                    .map(([accountId, login], index) => (
                      <View key={accountId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                        <T size={font.caption} tone="soft" style={{ flex: 1 }}>
                          {`${accountId === 'default' ? t('Default account') : t('Account {0}', { '0': String(index + 1) })} · ${planName(login.plan!)}`}
                        </T>
                        {login.upgradeUrl ? (
                          <Button
                            kind="ghost"
                            title={t('Upgrade plan')}
                            onPress={() => void Linking.openURL(login.upgradeUrl!).catch(() => {})}
                          />
                        ) : null}
                      </View>
                    ))}
                  <T
                    size={font.caption}
                    tone={bad ? 'bad' : 'muted'}
                    accessibilityRole={bad ? 'alert' : undefined}
                    accessibilityLiveRegion="polite"
                  >
                    {result
                      ? t(compatibilitySummary(result).key, compatibilitySummary(result).values)
                      : t('Compatibility is not reported by this host.')}
                    {result?.affects?.length ? ` ${result.affects.join(', ')}.` : ''}
                    {result?.recommend ? ` ${t('Recommended version: {0}', { '0': result.recommend })}` : ''}
                    {stale && result ? ` ${t('Showing the last result; the host is not reachable.')}` : ''}
                  </T>
                  {plan.manualInstall ? (
                    <T size={font.caption} tone="muted">
                      {t(
                        'Ramu cannot pick a compatible release for you. Install a compatible version manually, then check again.',
                      )}
                    </T>
                  ) : null}
                  {plan.actions.includes('update-ramu') ? (
                    <T size={font.caption} tone="muted">
                      {t('Update Ramu on the host to change this bundled runtime.')}
                    </T>
                  ) : null}
                  {plan.actions.includes('change-path') ? (
                    <T size={font.caption} tone="muted">
                      {t('Change the executable path in Ramu on the host.')}
                    </T>
                  ) : null}
                  {result && (result.status === 'incompatible' || result.status === 'limited') ? (
                    <T size={font.caption} tone="muted">
                      {`${t('Observed version')}: ${result.observedVersion ?? t('Unknown')} · ${t('Policy revision')}: ${result.policyRevision}`}
                      {result.evidence ? ` · ${t('Evidence')}: ${result.evidence}` : ''}
                    </T>
                  ) : null}
                  {plan.actions.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                      {plan.actions.includes('update') ? (
                        <Button
                          kind="secondary"
                          disabled={!online || busy === status.provider}
                          title={status.latestVersion ? t('Update to {0}', { '0': status.latestVersion }) : t('Update')}
                          onPress={() => void update(status.provider)}
                        />
                      ) : null}
                      <Button
                        kind="ghost"
                        disabled={!online || busy === status.provider}
                        title={t('Check again')}
                        onPress={() => checkAgain(status.provider)}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            )
          })
        ) : (
          <T size={font.control} tone="muted" style={{ padding: space.m }}>
            {t('No providers are installed on this computer.')}
          </T>
        )}
      </Card>
      {stale && statuses && !error ? <Hint>{t('Showing the last result; the host is not reachable.')}</Hint> : null}
      {error && statuses ? <Hint>{error}</Hint> : null}
      <Hint>{t('Checks run on the host and never start a conversation or use model credit.')}</Hint>
    </>
  )
}
