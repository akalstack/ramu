import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { shipActivityText, shipUndoText } from '@ramu/shared/ship'
import type { ShipActivity } from '@ramu/shared/types/ship'
import { ago, useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Section } from './InboxParts'
import { useOpenThread } from './paneContext'
import { Button, Row, T } from './ui'

type Entry = ShipActivity & { hostId: string }

/**
 * Inbox's Done on the phone: what Ship did without asking on each host, with Undo, which reverts that fix while nothing
 * came after it. Viewer pairings and hosts without Ship list nothing.
 */
export function ShipActivityList({ hostId }: { hostId: string | null }) {
  const store = useStore()
  const say = useSay()
  const openThread = useOpenThread()
  const runtime = useRef(store)
  runtime.current = store
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const hosts = store.computers
    .filter((pc) => pc.status === 'online' && pc.access !== 'viewer' && (!hostId || pc.id === hostId))
    .map((pc) => pc.id)
  const key = hosts.join(',')

  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    [],
  )
  const read = useCallback(async () => {
    const lists = await Promise.all(
      key
        .split(',')
        .filter(Boolean)
        .map((id) =>
          runtime.current
            .invoke(id, 'ship.activity')
            .then((list) => list.map((entry) => ({ ...entry, hostId: id })))
            .catch(() => [] as Entry[]),
        ),
    )
    if (live.current) setEntries(lists.flat().sort((a, b) => b.at - a.at))
  }, [key])

  // Read again when a host says its threads changed, which it does when Ship records or undoes a fix.
  useEffect(() => {
    void read()
    const offs = key
      .split(',')
      .filter(Boolean)
      .map((id) =>
        runtime.current.subscribe(id, (...[channel]) => {
          if (channel === 'workspace:changed') void read()
        }),
      )
    return () => offs.forEach((off) => off())
  }, [key, read])

  if (!entries.length) return null
  const undo = (entry: Entry) =>
    Alert.alert(shipUndoText(entry, say).title, shipUndoText(entry, say).body, [
      { text: say('Cancel'), style: 'cancel' },
      {
        text: shipUndoText(entry, say).confirm,
        style: 'destructive',
        onPress: () => {
          setBusy(true)
          void runtime.current
            .invoke(entry.hostId, 'ship.undo', entry.id)
            .then(
              () => read(),
              (reason: unknown) =>
                Alert.alert(say('That didn’t work'), reason instanceof Error ? reason.message : String(reason)),
            )
            .finally(() => setBusy(false))
        },
      },
    ])
  return (
    <Section title={say('Done for you')} count={entries.length}>
      <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
        {say('What Ship did without asking in the last week, which you can undo while nothing came after it.')}
      </T>
      {entries.map((entry) => {
        const text = shipActivityText(entry, say)
        const chat = store.chats.find((c) => c.computerId === entry.hostId && c.taskId === entry.taskId)
        return (
          <Row key={entry.id} onPress={chat ? () => openThread(chat.id) : undefined} accessibilityLabel={text.title}>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="600" numberOfLines={1}>
                {text.title}
              </T>
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {[text.detail, entry.title, ago(entry.undoneAt ?? entry.at)].filter(Boolean).join(' · ')}
              </T>
            </View>
            {!entry.undoneAt ? (
              <Button kind="secondary" title={say('Undo')} disabled={busy} onPress={() => undo(entry)} />
            ) : null}
          </Row>
        )
      })}
    </Section>
  )
}
