import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import type { SavedPermissionRule } from '@ramu/shared/types'
import { font, space } from '../theme'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { showError } from '../runtime/toast'
import { providerNames } from '../runtime/types'
import { Button, Card, Divider, SectionLabel, T, tap } from './ui'

/**
 * The "Always allow" approvals saved on a host, as the desktop's Saved approvals lists them, so one given by mistake can
 * be taken back from the phone: one at a time, or all at once.
 */
export function SavedApprovals({ hostId, locked }: { hostId: string; locked: boolean }) {
  const store = useStore()
  const say = useSay()
  const [rules, setRules] = useState<SavedPermissionRule[] | null>(null)
  const [busy, setBusy] = useState(false)
  const online = store.isOnline(hostId)
  const viewer = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const load = useCallback(() => {
    void store
      .invoke(hostId, 'settings.permissions.list')
      .then(setRules)
      .catch(() => setRules(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store.invoke is stable; reloads when the host or its connection changes
  }, [hostId])
  useEffect(() => {
    if (online && !viewer) load()
  }, [online, viewer, load])
  if (!online || viewer || !rules) return null
  const change = (work: () => Promise<unknown>) => {
    if (busy || locked) return
    tap()
    setBusy(true)
    void work()
      .then(load)
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <SectionLabel>{say('Saved approvals')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {!rules.length ? (
          <T size={font.control} tone="muted" style={{ padding: space.m }}>
            {say('No saved approvals yet. They appear here when you choose Always allow on an agent’s request.')}
          </T>
        ) : (
          rules.map((rule, index) => (
            <View key={rule.id}>
              {index ? <Divider inset={space.m} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T numberOfLines={2}>{rule.label}</T>
                  <T size={font.caption} tone="muted" numberOfLines={1}>
                    {[
                      providerNames[rule.provider],
                      rule.scope === 'project'
                        ? `${say('Project')}: ${rule.projectName ?? rule.projectId}`
                        : say('User'),
                    ].join(' · ')}
                  </T>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${say('Remove')}: ${rule.label}`}
                  disabled={busy || locked}
                  hitSlop={8}
                  onPress={() => change(() => store.invoke(hostId, 'settings.permissions.remove', rule.id))}
                >
                  <T size={font.caption} weight="600" tone={busy || locked ? 'muted' : 'bad'}>
                    {say('Remove')}
                  </T>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>
      {rules.length > 1 ? (
        <View style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          <Button
            kind="danger"
            title={say('Remove displayed approvals')}
            disabled={busy || locked}
            onPress={() =>
              Alert.alert(say('Remove displayed approvals'), undefined, [
                { text: say('Cancel'), style: 'cancel' },
                {
                  text: say('Remove'),
                  style: 'destructive',
                  onPress: () => change(() => store.invoke(hostId, 'settings.permissions.clear', { scope: 'all' })),
                },
              ])
            }
          />
        </View>
      ) : null}
    </>
  )
}
