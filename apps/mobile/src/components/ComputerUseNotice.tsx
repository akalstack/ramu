import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { Monitor, Square } from 'lucide-react-native'
import { useComputerUse } from '../runtime/computerUse'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T } from './ui'

/** A persistent, per-thread stop control, separate from agent Stop and from horizontally scrolling tools. */
export function ComputerUseNotice({ chat }: { chat: Chat }) {
  const { session, refresh } = useComputerUse(chat.computerId, chat.taskId)
  const store = useStore()
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  if (!session) return null
  const online = store.isOnline(chat.computerId)
  const active = session.controller.kind === 'agent' && !session.paused
  const id = store.language === 'id'
  const label = active ? (id ? 'Menggunakan komputer' : 'Using computer') : id ? 'Akses komputer' : 'Computer access'
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingHorizontal: space.m,
        minHeight: 40,
        borderRadius: radius.s,
        backgroundColor: c.fill,
      }}
    >
      <Monitor size={14} color={active ? c.warn : c.muted} />
      <T size={font.caption} numberOfLines={1} style={{ flex: 1 }}>
        {label} · {session.target.name}
        {!online ? ' · Offline' : ''}
      </T>
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
        style={{
          minHeight: 40,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          opacity: busy || !online ? 0.4 : 1,
        }}
      >
        <Square size={11} color={c.bad} fill={c.bad} />
        <T size={font.caption} tone="bad">
          {busy ? '…' : id ? 'Hentikan' : 'Stop'}
        </T>
      </Pressable>
    </View>
  )
}
