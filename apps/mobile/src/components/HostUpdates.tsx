import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, Pressable, View } from 'react-native'
import type { AgentProvider, HostUpdateResult } from '@ramu/shared/types'
import { hostUpdateSummary, hoursUntil, type HostUpdateSummary, type WaitingUpdate } from '@ramu/shared/updates'
import { providerName } from '@ramu/shared/providers/providers'
import { useStore } from '../runtime/store'
import { showError } from '../runtime/toast'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { T } from './ui'

/**
 * A host's Ramu version and provider CLIs on its card, with Update for each when something is newer. The phone asks the
 * host; the host decides how it can install Ramu (its desktop app, or rebuilding a headless checkout) and says why not.
 * A device that may only view gets no answer from the host, so it shows nothing here.
 */
export function HostUpdates({ hostId, name, running }: { hostId: string; name: string; running: number }) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [summary, setSummary] = useState<HostUpdateSummary | null>(null)
  // What is updating: Ramu, every provider, or one provider by name.
  const [busy, setBusy] = useState<'ramu' | 'providers' | AgentProvider | null>(null)
  const online = store.isOnline(hostId)
  const load = useCallback(() => {
    if (!online) return
    void Promise.all([
      store.invoke(hostId, 'updates.status').catch(() => null),
      store.invoke(hostId, 'providers.updates').catch(() => []),
    ]).then(([app, providers]) => setSummary(app ? hostUpdateSummary(app, providers) : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [hostId, online]; the store is current as of that run
  }, [hostId, online])
  useEffect(load, [load])
  if (!summary) return null
  const report = (result: HostUpdateResult) =>
    Alert.alert(name, result.message, [
      ...(result.notesUrl
        ? [{ text: say('Open release'), onPress: () => void Linking.openURL(result.notesUrl!) }]
        : []),
      { text: say('OK') },
    ])
  const updateRamu = () =>
    Alert.alert(
      say('Update {0}?', { 0: name }),
      [
        say('Ramu {0} installs on {1}, which restarts and reconnects.', { 0: summary.nextVersion!, 1: name }),
        running
          ? say(
              '{0} threads are working there. Threads continue after the restart when Continue threads after restart is on.',
              { 0: running },
            )
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Update Ramu'),
          onPress: () => {
            setBusy('ramu')
            store
              .invoke(hostId, 'updates.apply')
              .then(report, (error) => Alert.alert(name, error instanceof Error ? error.message : String(error)))
              .finally(() => {
                setBusy(null)
                load()
              })
          },
        },
      ],
    )
  const updateProviders = async (only?: AgentProvider) => {
    setBusy(only ?? 'providers')
    const failed: string[] = []
    for (const entry of summary.providers.filter((item) => !only || item.provider === only))
      await store.invoke(hostId, 'providers.update', entry.provider).catch((error) =>
        failed.push(
          say('{0} could not be updated: {1}', {
            0: providerName(entry.provider),
            1: (error instanceof Error ? error.message : String(error)).replace(/^CLI update failed:?\s*/, ''),
          }),
        ),
      )
    setBusy(null)
    // Where the other results of an action show: an error toast near the bottom, not a dialog to dismiss.
    if (failed.length) showError(failed.join('\n'))
    load()
  }
  const line = [
    summary.currentVersion ? say('Ramu {0}', { 0: summary.currentVersion }) : null,
    summary.nextVersion ? say('{0} available', { 0: summary.nextVersion }) : null,
  ].filter(Boolean)
  const action = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      disabled={!!busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 30,
        justifyContent: 'center',
        paddingHorizontal: space.s + 2,
        borderRadius: radius.full,
        backgroundColor: pressed ? c.pressed : c.fill,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <T size={font.control} weight="500" tone="accent">
        {label}
      </T>
    </Pressable>
  )
  const row = (key: string, label: string, detail: string, updating: boolean, onPress: () => void) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 34 }}>
      <View style={{ flex: 1 }}>
        <T size={font.control} numberOfLines={1}>
          {label}
        </T>
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {detail}
        </T>
      </View>
      {action(updating ? say('Updating…') : say('Update'), onPress)}
    </View>
  )
  // A release out less than a day: installing it now is a choice, asked once.
  const installNow = (entry: WaitingUpdate) => {
    const label = `${entry.provider === 'ramu' ? 'Ramu' : providerName(entry.provider)} ${entry.version}`
    Alert.alert(
      say('Install {0} now?', { 0: label }),
      say(
        '{0} came out less than a day ago. Ramu waits a day before offering a release, because a bad one is usually pulled by then.',
        { 0: label },
      ),
      [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Install it anyway'),
          style: 'destructive',
          onPress: () => {
            const provider = entry.provider
            setBusy(provider)
            const run =
              provider === 'ramu'
                ? store.invoke(hostId, 'updates.apply', true).then(report)
                : store.invoke(hostId, 'providers.update', provider, true).then(() => {})
            run
              .catch((error) => Alert.alert(name, error instanceof Error ? error.message : String(error)))
              .finally(() => {
                setBusy(null)
                load()
              })
          },
        },
      ],
    )
  }
  const count = summary.providers.length + (summary.nextVersion ? 1 : 0)
  return (
    <View style={{ gap: space.xs }}>
      <T size={font.caption} tone="muted">
        {line.join(' · ') || (count || summary.waiting.length ? '' : say('Up to date'))}
      </T>
      {summary.nextVersion
        ? row(
            'ramu',
            say('Ramu {0}', { 0: summary.nextVersion }),
            say('Restarts {0}', { 0: name }),
            busy === 'ramu',
            updateRamu,
          )
        : null}
      {summary.providers.map((entry) =>
        row(
          entry.provider,
          providerName(entry.provider),
          entry.version && entry.latest ? `${entry.version} → ${entry.latest}` : (entry.latest ?? ''),
          busy === entry.provider || busy === 'providers',
          () => void updateProviders(entry.provider),
        ),
      )}
      {summary.waiting.map((entry) => (
        <View
          key={`waiting:${entry.provider}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 34 }}
        >
          <View style={{ flex: 1 }}>
            <T size={font.control} numberOfLines={1}>
              {`${entry.provider === 'ramu' ? 'Ramu' : providerName(entry.provider)} ${entry.version}`}
            </T>
            <T size={font.caption} tone="muted" numberOfLines={1}>
              {entry.until
                ? say('Out less than a day; offered in {0}h', { 0: hoursUntil(entry.until) })
                : say('Out less than a day')}
            </T>
          </View>
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            disabled={!!busy}
            onPress={() => installNow(entry)}
            style={({ pressed }) => ({
              minHeight: 30,
              justifyContent: 'center',
              paddingHorizontal: space.s + 2,
              borderRadius: radius.full,
              backgroundColor: pressed ? c.pressed : 'transparent',
              opacity: busy ? 0.6 : 1,
            })}
          >
            <T size={font.control} weight="500" tone="muted">
              {busy === entry.provider ? say('Updating…') : say('Update now')}
            </T>
          </Pressable>
        </View>
      ))}
      {summary.providers.length > 1 ? (
        <View style={{ flexDirection: 'row' }}>
          {action(
            busy === 'providers'
              ? say('Updating…')
              : say('Update all providers ({0})', { 0: summary.providers.length }),
            () => void updateProviders(),
          )}
        </View>
      ) : null}
    </View>
  )
}
