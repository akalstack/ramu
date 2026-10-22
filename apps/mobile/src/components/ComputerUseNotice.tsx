import { useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { Monitor, Square } from 'lucide-react-native'
import { useComputerUse } from '../runtime/computerUse'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T } from './ui'

/** A persistent, per-thread stop control, separate from agent Stop and from horizontally scrolling tools. */
export function ComputerUseNotice({ chat, onOpen }: { chat: Chat; onOpen?(): void }) {
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        paddingRight: 0,
        minHeight: 32,
        borderRadius: radius.full,
        backgroundColor: c.fill,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={id ? 'Buka komputer' : 'Open computer'}
        disabled={!onOpen}
        onPress={onOpen}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingLeft: space.s + 2 }}
      >
        <Monitor size={14} color={active ? c.warn : c.muted} />
        <T size={font.caption} numberOfLines={1} style={{ maxWidth: 150 }}>
          {label} · {session.target.name}
          {!online ? ' · Offline' : ''}
        </T>
      </Pressable>
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
              Alert.alert('Could not stop computer use', error instanceof Error ? error.message : String(error)),
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
    </View>
  )
}
