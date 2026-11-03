import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, Pressable, View } from 'react-native'
import type { HostUpdateResult } from '@ramu/shared/types'
import { hostUpdateSummary, type HostUpdateSummary } from '@ramu/shared/updates'
import { providerName } from '@ramu/shared/providers/providers'
import { useStore } from '../runtime/store'
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
  const [busy, setBusy] = useState<'ramu' | 'providers' | null>(null)
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
  const updateProviders = async () => {
    setBusy('providers')
    const failed: string[] = []
    for (const entry of summary.providers)
      await store
        .invoke(hostId, 'providers.update', entry.provider)
        .catch((error) =>
          failed.push(`${providerName(entry.provider)}: ${error instanceof Error ? error.message : String(error)}`),
        )
    setBusy(null)
    if (failed.length) Alert.alert(name, failed.join('\n'))
    load()
  }
  const line = [
    summary.currentVersion ? say('Ramu {0}', { 0: summary.currentVersion }) : null,
    summary.nextVersion ? say('{0} available', { 0: summary.nextVersion }) : null,
    summary.providers.length
      ? say('Updates for {0}', { 0: summary.providers.map((entry) => providerName(entry.provider)).join(', ') })
      : null,
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
  return (
    <View style={{ gap: space.xs }}>
      <T size={font.caption} tone="muted">
        {line.join(' · ') || say('Up to date')}
      </T>
      {summary.nextVersion || summary.providers.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {summary.nextVersion ? action(busy === 'ramu' ? say('Updating…') : say('Update Ramu'), updateRamu) : null}
          {summary.providers.length
            ? action(busy === 'providers' ? say('Updating…') : say('Update providers'), () => void updateProviders())
            : null}
        </View>
      ) : null}
    </View>
  )
}
