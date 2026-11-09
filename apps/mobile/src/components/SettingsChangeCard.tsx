import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Settings2, Undo2 } from 'lucide-react-native'
import { SETTINGS_MENU } from '@ramu/shared/settingsMenu'
import { readableSettingValue, type SettingsChangeCard as Card } from '@ramu/shared/settingsChanges'
import { font, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, Card as Surface, Divider, T } from './ui'

const STATE_LABEL = {
  waiting: 'Waiting for you',
  applied: 'Applied',
  dismissed: 'Dismissed',
  undone: 'Undone',
} as const

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Settings an agent asked to change, to apply, open in Settings, dismiss or undo from the phone. Applying needs this
 * phone's Change settings permission on the host, which the host checks.
 */
export function SettingsChangeCard({ computerId, cardId }: { computerId: string; cardId: string }) {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const { c } = useTheme()
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(
    () =>
      store
        .invoke(computerId, 'settings.changeCard.get', cardId)
        .then(setCard)
        .catch(() => setCard(null)),
    [store, computerId, cardId],
  )
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    void read()
    // The card changes as it is applied on this phone or elsewhere; the host announces it with the thread lists.
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (channel !== 'workspace:changed') return
      clearTimeout(timer)
      timer = setTimeout(() => void readRef.current(), 400)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [read, store, computerId])

  if (card === undefined) return null
  if (card === null)
    return (
      <T size={font.caption} tone="muted" style={{ marginVertical: space.s }}>
        {say('This settings card is gone.')}
      </T>
    )

  const run = async (
    method: 'settings.changeCard.apply' | 'settings.changeCard.undo' | 'settings.changeCard.dismiss',
  ) => {
    setBusy(true)
    setError(null)
    try {
      setCard(await store.invoke(computerId, method, card.id))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const first = card.rows[0]
  const page = first && SETTINGS_MENU.find((entry) => entry.id === first.section)
  const openSettings =
    first && page?.phone
      ? () => router.push({ pathname: '/settings/[section]', params: { section: first.section, target: first.title } })
      : undefined
  const problem = error ?? card.error

  return (
    <Surface style={{ marginVertical: space.s, padding: space.m, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Settings2 size={16} color={c.text} />
        <T weight="600" numberOfLines={1} style={{ flex: 1 }}>
          {card.rows.length === 1 ? say('Change a setting') : say('Change {0} settings', { '0': card.rows.length })}
        </T>
        <T size={font.caption} tone={card.state === 'applied' ? 'ok' : 'muted'}>
          {say(STATE_LABEL[card.state])}
        </T>
      </View>
      <T size={font.caption} tone="muted">
        {card.reason}
      </T>
      {card.rows.map((row) => (
        <View key={row.path} style={{ gap: 2 }}>
          <Divider />
          <T weight="500">
            {say(row.title)}
            <T size={font.caption} tone="muted">
              {' · '}
              {say(SETTINGS_MENU.find((entry) => entry.id === row.section)?.label ?? row.section)}
            </T>
          </T>
          <T size={font.caption} tone="muted">
            {readableSettingValue(row.before, (text) => say(text))} →{' '}
            {readableSettingValue(row.value, (text) => say(text))}
          </T>
        </View>
      ))}
      {problem ? (
        <T size={font.caption} tone="bad" accessibilityRole="alert">
          {problem}
        </T>
      ) : null}
      {card.state === 'waiting' ? (
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          <Button
            title={say('Dismiss')}
            kind="ghost"
            disabled={busy}
            onPress={() => void run('settings.changeCard.dismiss')}
          />
          {openSettings ? (
            <Button title={say('Open in Settings')} kind="secondary" disabled={busy} onPress={openSettings} />
          ) : null}
          <Button
            title={say('Apply')}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={() => void run('settings.changeCard.apply')}
          />
        </View>
      ) : card.state === 'applied' ? (
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          {problem && openSettings ? (
            <Button title={say('Open in Settings')} kind="secondary" disabled={busy} onPress={openSettings} />
          ) : null}
          <Button
            title={say('Undo')}
            icon={Undo2}
            kind="secondary"
            disabled={busy}
            onPress={() => void run('settings.changeCard.undo')}
          />
        </View>
      ) : null}
    </Surface>
  )
}
