import { useEffect, useState } from 'react'
import { AppState, Image, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Move, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { liveState, liveSurface, type LiveSurface } from '@ramu/shared/liveView'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import { useSay } from '../i18n'
import { closeLiveView, moveLiveView, pinLiveSurface, useLiveViewPin } from '../runtime/liveView'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, T } from './ui'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const FRAME_MS = 1000

/** A small view of one thread's Browser or Computer that stays over every screen; Stop and Close never hide. */
export function LiveView() {
  const pin = useLiveViewPin()
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const insets = useSafeAreaInsets()
  const invoke = store.invoke as unknown as Invoke
  const [computer, setComputer] = useState<ComputerSessionSummary | null>(null)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [image, setImage] = useState<string | null>(null)
  const hostId = pin?.hostId ?? ''
  const taskId = pin?.taskId ?? ''
  const online = !!pin && store.isOnline(hostId)
  useEffect(() => {
    if (!pin || !online) return
    let live = true
    const read = async () => {
      const session = (await invoke(hostId, 'computer.session', taskId).catch(
        () => null,
      )) as ComputerSessionSummary | null
      const list = (await invoke(hostId, 'hostBrowser.list', taskId).catch(() => [])) as BrowserTabInfo[]
      if (!live) return
      setComputer(session)
      setTabs(list)
    }
    void read()
    const timer = setInterval(() => void read(), 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [hostId, taskId, online]) // eslint-disable-line react-hooks/exhaustive-deps -- `invoke` is stable per store
  const surface: LiveSurface | null = pin
    ? liveSurface(pin, { computer: !!computer, tabs: tabs.map((tab) => ({ id: tab.id, host: true })) })
    : null
  const key = surface ? JSON.stringify(surface) : ''
  useEffect(() => {
    setImage(null)
    if (!surface || !online) return
    let live = true
    let hash: string | undefined
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        if (AppState.currentState === 'active') {
          if (surface.kind === 'computer') {
            const frame = (await invoke(hostId, 'computer.frame', taskId, ...(hash ? [hash] : []))) as {
              hash: string
              unchanged?: boolean
              mimeType?: string
              data?: string
            }
            hash = frame.hash
            if (live && !frame.unchanged) setImage(`data:${frame.mimeType};base64,${frame.data}`)
          } else {
            const frame = (await invoke(hostId, 'hostBrowser.frame', taskId, surface.tabId)) as {
              mimeType: string
              data: string
            }
            if (live) setImage(`data:${frame.mimeType};base64,${frame.data}`)
          }
        }
      } catch {
        // The header still says where things stand.
      } finally {
        if (live) timer = setTimeout(() => void read(), FRAME_MS)
      }
    }
    void read()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key, online, hostId, taskId]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on what it shows
  if (!pin) return null
  const chat = store.chats.find((entry) => entry.computerId === hostId && entry.taskId === taskId)
  const viewOnly = store.computers.find((pc) => pc.id === hostId)?.access === 'viewer'
  const state = liveState(chat?.status)
  const stateText = !online
    ? say('Reconnecting…')
    : state === 'needs-you'
      ? say('Needs you')
      : state === 'working'
        ? say('Working')
        : state === 'failed'
          ? say('Failed')
          : state === 'finished'
            ? say('Finished')
            : say('Idle')
  const top = pin.corner.startsWith('top')
  const left = pin.corner.endsWith('left')
  return (
    <View
      accessibilityLabel={say('Live view')}
      style={{
        position: 'absolute',
        width: 220,
        ...(top ? { top: insets.top + 56 } : { bottom: insets.bottom + 96 }),
        ...(left ? { left: space.m } : { right: space.m }),
        backgroundColor: c.raised2,
        borderRadius: radius.l,
        padding: space.s,
        gap: space.xs,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <View style={{ flex: 1 }}>
          <T size={font.caption} weight="600" numberOfLines={1}>
            {chat?.title ?? say('Thread')}
          </T>
          <T
            size={font.caption}
            tone={state === 'needs-you' ? 'warn' : state === 'failed' ? 'bad' : 'muted'}
            numberOfLines={1}
          >
            {stateText}
          </T>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say('Move live view')}
          hitSlop={8}
          onPress={moveLiveView}
        >
          <Move size={14} color={c.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say('Close live view')}
          hitSlop={8}
          onPress={closeLiveView}
        >
          <X size={16} color={c.muted} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={say('Open')}
        onPress={() => {
          if (chat) router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
        }}
        style={{ aspectRatio: 16 / 10, borderRadius: radius.m, overflow: 'hidden', backgroundColor: c.fill }}
      >
        {image && online ? (
          <Image source={{ uri: image }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        ) : (
          <T size={font.caption} tone="muted" style={{ padding: space.s }}>
            {!online
              ? say('Reconnecting…')
              : surface
                ? say('Waiting for a picture…')
                : say('Nothing to show yet. The view follows Browser and Computer when the agent uses them.')}
          </T>
        )}
      </Pressable>
      {computer && tabs.length ? (
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Button
            kind={surface?.kind === 'computer' ? 'secondary' : 'ghost'}
            title={say('Computer')}
            onPress={() => pinLiveSurface({ kind: 'computer' })}
          />
          <Button
            kind={surface?.kind === 'browser' ? 'secondary' : 'ghost'}
            title={say('Browser')}
            onPress={() => pinLiveSurface({ kind: 'browser', tabId: tabs[0]!.id, host: true })}
          />
        </View>
      ) : null}
      {!viewOnly ? (
        <Button
          kind="danger"
          title={say('Stop the agent')}
          disabled={!online || !chat?.sessionId}
          onPress={() => {
            if (chat?.sessionId) void invoke(hostId, 'agent.stop', chat.sessionId).catch(() => {})
          }}
        />
      ) : null}
    </View>
  )
}
