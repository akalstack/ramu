import { useSay } from '../i18n'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { Monitor, Square } from 'lucide-react-native'
import { useComputerUse } from '../runtime/computerUse'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T } from './ui'
import { ActivityPill } from './ActivityPill'

/** A persistent, per-thread stop control, separate from agent Stop and from horizontally scrolling tools. */
export function ComputerUseNotice({ chat, onOpen }: { chat: Chat; onOpen?(): void }) {
  const say = useSay()
  const { session, refresh } = useComputerUse(chat.computerId, chat.taskId)
  const store = useStore()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  if (!session) return null
  const online = store.isOnline(chat.computerId)
  const active = session.controller.kind === 'agent' && !session.paused
  const id = store.language === 'id'
  const label = active ? (id ? 'Menggunakan komputer' : 'Using computer') : id ? 'Komputer' : 'Computer'
  return (
    <ActivityPill
      icon={Monitor}
      label={`${label} · ${session.target.name}`}
      accessibilityLabel={`${id ? 'Buka komputer' : 'Open computer'}, ${session.target.name}`}
      tone={!online ? 'off' : active ? 'attention' : 'quiet'}
      emphasis={active}
      iconOnly={!active}
      onPress={onOpen}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={id ? 'Hentikan penggunaan komputer' : 'Stop computer use'}
          accessibilityState={{ disabled: busy || !online }}
          disabled={busy || !online}
          onPress={(event) => {
            event.stopPropagation()
            setBusy(true)
            void store
              .invoke(chat.computerId, 'computer.revoke', chat.taskId)
              .then(() => refresh())
              .catch((error) =>
                Alert.alert(say('Could not stop computer use'), error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setBusy(false))
          }}
          hitSlop={8}
          style={{
            width: 26,
            height: 26,
            marginLeft: space.xs,
            marginRight: 3,
            borderRadius: radius.full,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy || !online ? 0.4 : 1,
          }}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bad, opacity: 0.18 }]} />
          {busy ? <T size={font.caption}>…</T> : <Square size={10} color={c.bad} fill={c.bad} />}
        </Pressable>
      }
    />
  )
}
