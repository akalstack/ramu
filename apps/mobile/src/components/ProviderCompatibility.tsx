import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { compatibilityPlan, incompatibleText } from '@ramu/shared/providers/compatibilityPlan'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import { useStore } from '../runtime/store'
import { providerEnabledEdits, providerSwitches } from '../runtime/settingsModel'
import { canWriteHost } from '../runtime/viewerAccess'
import { font, space, useTheme } from '../theme'
import { Button, Card, Divider, SectionLabel, T } from './ui'
import { Hint, ToggleRow } from './SettingRows'
import { ProviderLogins } from './ProviderLogins'
import { ProviderIcon } from './Logos'
import { useHostSettings } from '../runtime/useHostSettings'

/** Last result per host, so an unreachable host still shows what was known, marked as stale. */
const lastKnown = new Map<string, ProviderStatus[]>()

/**
 * Which providers the host offers agents, as the desktop's provider switches: every provider is listed, so one turned
 * off can be turned back on, and the last one on stays on because the host refuses to save none.
 */
export function ProviderSwitches({
  settings,
  statuses,
  writable,
}: {
  settings: ReturnType<typeof useHostSettings>
  statuses: ProviderStatus[] | null
  writable: boolean
}) {
  const store = useStore()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  if (settings.state.status !== 'ready') return null
  const known = new Set(settings.state.settings.map((setting) => setting.path))
  const shown = providerSwitches(settings.read).filter(({ provider }) =>
    known.has(`providerBinaries.${provider}.enabled`),
  )
  if (!shown.length) return null
  return (
    <>
      <SectionLabel>{t('Providers')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {shown.map(({ provider, enabled, locked }, index) => {
          const status = statuses?.find((entry) => entry.provider === provider)
          const help = locked
            ? t('Keep at least one provider turned on')
            : !enabled
              ? t('Off. Agents do not use it, and it is not checked for updates.')
              : status && !status.installed
                ? t('Not installed')
                : (status?.version ?? undefined)
          return (
            <View key={provider}>
              {index ? <Divider inset={space.l} /> : null}
              <ToggleRow
                title={providerName(provider)}
                help={help}
                value={enabled}
                disabled={!writable || locked}
                onChange={(next) => settings.setAll(providerEnabledEdits(settings.read, provider, next))}
              />
            </View>
          )
        })}
      </Card>
    </>
  )
}

/**
 * Installed providers as the selected host reports them, with their logins; a version Ramu cannot use says so with the
 * fix, and every other version stays quiet. Every probe and update runs on that host;
 * the phone never inspects itself. Path changes and Ramu updates stay on the host, so they appear as guidance.
 */
export function ProviderCompatibility({ hostId, locked }: { hostId: string; locked: boolean }) {
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
  const settings = useHostSettings(hostId)

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
  const writable = !locked && canWriteHost(store.computers.find((computer) => computer.id === hostId))
  return (
    <>
      <ProviderSwitches settings={settings} statuses={statuses} writable={writable} />
      <SectionLabel>{t('Installed providers')}</SectionLabel>
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
            // A custom executable path is set on the host; its own status already withholds updates for it.
            const plan = compatibilityPlan(status, { customBinary: false, canUpdate: online && !status.updateError })
            const problem = incompatibleText(status, plan, t)
            // What to do about it, in one paragraph, instead of a stack of notes.
            const guidance = problem
              ? [
                  problem,
                  plan.actions.includes('update-ramu')
                    ? t('Update Ramu on the host to change this bundled runtime.')
                    : '',
                  plan.actions.includes('change-path') ? t('Change the executable path in Ramu on the host.') : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              : null
            return (
              <View key={status.provider}>
                {index ? <Divider inset={space.l} /> : null}
                <View style={{ padding: space.m, gap: space.m }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        backgroundColor: c.fill,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <ProviderIcon provider={status.provider} size={16} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T weight="600">{providerName(status.provider)}</T>
                      {problem ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.bad }} />
                          <T size={font.caption} tone="bad" style={{ flex: 1 }}>
                            {t('Cannot be used with this Ramu release')}
                          </T>
                        </View>
                      ) : null}
                    </View>
                    {status.version ? (
                      <T size={font.caption} tone="muted" mono>
                        {status.version}
                      </T>
                    ) : null}
                  </View>
                  {/* Each login with how it signs in now (plan or API key), and a switch to stop using it. */}
                  <View
                    style={{
                      borderRadius: 10,
                      backgroundColor: c.fill,
                      paddingHorizontal: space.m,
                      paddingVertical: space.s,
                    }}
                  >
                    <ProviderLogins status={status} settings={settings} disabled={!online} />
                  </View>
                  {guidance ? (
                    <T size={font.caption} tone="bad" accessibilityRole="alert" accessibilityLiveRegion="polite">
                      {guidance}
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
