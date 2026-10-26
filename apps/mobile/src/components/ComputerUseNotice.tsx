import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { revealsComputer, type ComputerGlance } from '../runtime/floatPreview'
import { FloatPreview } from './BrowserNotice'
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

/**
 * When the agent starts using this thread's computer, a small live picture of the screen floats over the chat, like
 * the browser's. Tapping it opens the full viewer; it hides when dismissed or the app is in the background.
 */
export function ComputerFloat({
  chat,
  hidden,
  covered = false,
  onVisibleChange,
  onOpen,
  onReveal,
}: {
  chat: Chat
  hidden: boolean
  /** Another preview holds the dock; this one still notices new activity and returns when it is free. */
  covered?: boolean
  /** Whether this preview is on screen, so the other one knows when the dock is free. */
  onVisibleChange?(visible: boolean): void
  onOpen(): void
  onReveal?(): void
}) {
  const { session } = useComputerUse(chat.computerId, chat.taskId)
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const t = (text: string) => translate(store.language, text)
  const seen = useRef<ComputerGlance | null>(null)
  const [shown, setShown] = useState(false)
  const [image, setImage] = useState<{ uri: string; aspect: number } | null>(null)
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])
  const glance: ComputerGlance = {
    present: !!session,
    agent: session?.controller.kind === 'agent' && !session.paused,
  }
  const glanceKey = `${glance.present}:${glance.agent}`
  useEffect(() => {
    const reveal = revealsComputer(seen.current, glance)
    seen.current = glance
    if (!glance.present) setShown(false)
    else if (reveal && !hidden) {
      setShown(true)
      onReveal?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a change in what the computer is doing is what matters
  }, [glanceKey])
  const visible = shown && !!session && !hidden && !covered && foreground && store.isOnline(chat.computerId)
  const reportVisible = useRef(onVisibleChange)
  reportVisible.current = onVisibleChange
  useEffect(() => reportVisible.current?.(visible), [visible])
  useEffect(() => {
    setImage(null)
    if (!visible || !chat.taskId) return
    let active = true
    let hash: string | undefined
    let timer: ReturnType<typeof setTimeout>
    // The host answers when the screen changes, so a still screen costs nothing; a glance every few seconds is enough.
    const read = async () => {
      try {
        const next = await io.current.invoke(chat.computerId, 'computer.frame', chat.taskId!, ...(hash ? [hash] : []))
        hash = next.hash
        if (active && !next.unchanged)
          setImage({ uri: `data:${next.mimeType};base64,${next.data}`, aspect: next.width / next.height })
      } catch {
        // No frame for this device: the card still says what the computer is doing.
      } finally {
        if (active) timer = setTimeout(() => void read(), 2500)
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [visible, chat.computerId, chat.taskId])
  if (!visible || !session) return null
  return (
    <FloatPreview
      image={image}
      fallback={Monitor}
      title={session.target.name}
      agent={glance.agent}
      openLabel={`${t('Open computer')}, ${session.target.name}`}
      hideLabel={t('Hide preview')}
      onOpen={() => {
        setShown(false)
        onOpen()
      }}
      onHide={() => setShown(false)}
    />
  )
}
