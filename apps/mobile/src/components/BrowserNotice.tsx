import { useEffect, useRef, useState } from 'react'
import { AppState, Image, Pressable, View } from 'react-native'
import { ChevronRight, Globe, X } from 'lucide-react-native'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { translate } from '@ramu/shared/i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { revealedTab, tabTitle } from '../runtime/browserViewerState'
import { font, radius, space, useTheme } from '../theme'
import { Glass } from './Glass'
import { T, tap, type Icon } from './ui'

/** This thread's browser tabs, metadata only. One reader feeds both the activity pill and the floating preview. */
export function useThreadBrowserTabs(chat: Chat | undefined) {
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const host = chat?.computerId ?? ''
  const task = chat?.taskId
  const online = !!host && store.isOnline(host)
  const viewOnly = store.computers?.find((computer) => computer.id === host)?.access === 'viewer'
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [viewable, setViewable] = useState(false)
  useEffect(() => {
    if (viewOnly || !task || !online) return
    let active = true
    const load = async () => {
      try {
        const status = await io.current.invoke(host, 'hostBrowser.status').catch(() => null)
        const live = !!(status?.viewable ?? status?.enabled)
        const listed = live
          ? await io.current.invoke(host, 'hostBrowser.list', task)
          : (await io.current.invoke(host, 'browser.activity', task)).tabs
        if (!active) return
        setViewable(live)
        setTabs(listed)
      } catch {
        // Metadata only: keep the last known tabs rather than flashing them away on a missed read.
      }
    }
    void load()
    const off = io.current.subscribe(host, (channel) => {
      if (['browser:changed', 'hostBrowser:changed', 'browser:present', 'hostBrowser:present'].includes(channel))
        void load()
    })
    const timer = setInterval(() => void load(), 5000)
    return () => {
      active = false
      off()
      clearInterval(timer)
    }
  }, [host, task, online, viewOnly])
  return { tabs: viewOnly || !task ? [] : tabs, viewable: viewable && !viewOnly }
}

/** Sits with the computer-use bar: shows when this thread has browser tabs and opens the live view in one tap. */
export function BrowserNotice({ chat, tabs, onOpen }: { chat: Chat; tabs: BrowserTabInfo[]; onOpen(): void }) {
  const store = useStore()
  const { c } = useTheme()
  const online = store.isOnline(chat.computerId)
  const tab = tabs[0]
  if (!chat.taskId || !tab) return null
  const id = store.language === 'id'
  const agent = tabs.some((entry) => entry.controller === 'agent' && !entry.paused)
  const label = agent ? (id ? 'Menggunakan browser' : 'Using browser') : 'Browser'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={id ? 'Buka browser' : 'Open browser'}
      onPress={onOpen}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        maxWidth: 230,
        paddingHorizontal: space.s + 2,
        minHeight: 32,
        borderRadius: radius.full,
        backgroundColor: c.fill,
      }}
    >
      <Globe size={14} color={agent ? c.warn : c.muted} />
      <T size={font.caption} numberOfLines={1} style={{ flexShrink: 1, maxWidth: 170 }}>
        {agent ? `${label} · ` : ''}
        {tab.title || tab.url}
        {!online ? ' · Offline' : ''}
      </T>
      <ChevronRight size={12} color={c.muted} />
    </Pressable>
  )
}

const PREVIEW_WIDTH = 152

/**
 * When the agent opens a page, a small live preview floats over the chat so the person sees it without leaving the
 * conversation. Tapping it opens that tab full screen; it hides when dismissed, closed, or the app is in the background.
 */
export function BrowserFloat({
  chat,
  tabs,
  viewable,
  hidden,
  covered = false,
  onVisibleChange,
  top,
  onOpen,
  onReveal,
}: {
  chat: Chat
  tabs: BrowserTabInfo[]
  viewable: boolean
  /** The browser or another full-screen surface is open over the chat. */
  hidden: boolean
  /** Another preview holds the corner; this one still notices new activity and returns when it is free. */
  covered?: boolean
  /** Whether this preview is on screen, so the other one knows when the corner is free. */
  onVisibleChange?(visible: boolean): void
  top: number
  onOpen(tabId: string): void
  /** A new page appeared, so the chat can show this preview rather than another one. */
  onReveal?(): void
}) {
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const t = (text: string) => translate(store.language, text)
  const known = useRef<Set<string> | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [frame, setFrame] = useState<{ uri: string; aspect: number } | null>(null)
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    const reveal = revealedTab(known.current, tabs)
    known.current = new Set(tabs.map((tab) => tab.id))
    // Tabs opened while the browser is on screen are the person's own; they never pop up afterwards.
    if (reveal && !hidden) {
      setShown(reveal)
      onReveal?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new reveal is what matters, not a new callback
  }, [tabs, hidden])
  const tab = tabs.find((entry) => entry.id === shown)
  const visible = !!tab && !hidden && !covered && foreground && viewable && store.isOnline(chat.computerId)
  const reportVisible = useRef(onVisibleChange)
  reportVisible.current = onVisibleChange
  useEffect(() => reportVisible.current?.(visible), [visible])
  const tabId = tab?.id
  useEffect(() => {
    setFrame(null)
    if (!visible || !tabId || !chat.taskId) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    // A still frame every couple of seconds is enough for a glance and keeps the phone's data use low.
    const read = async () => {
      try {
        const image = await io.current.invoke(chat.computerId, 'hostBrowser.frame', chat.taskId!, tabId)
        if (active) setFrame({ uri: `data:${image.mimeType};base64,${image.data}`, aspect: image.width / image.height })
      } catch {
        // Not allowed to view frames, or a busy host: the card still shows the page title.
      } finally {
        if (active) timer = setTimeout(() => void read(), 2000)
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [visible, tabId, chat.computerId, chat.taskId])
  if (!visible || !tab) return null
  return (
    <FloatPreview
      top={top}
      image={frame}
      fallback={Globe}
      title={tabTitle(tab, t)}
      agent={tab.controller === 'agent' && !tab.paused}
      openLabel={`${t('Open browser')}, ${tabTitle(tab, t)}`}
      hideLabel={t('Hide preview')}
      onOpen={() => {
        setShown(null)
        onOpen(tab.id)
      }}
      onHide={() => setShown(null)}
    />
  )
}

/** The small live card that floats over a chat: a picture, who is driving it, and a hide button. */
export function FloatPreview({
  top,
  image,
  fallback: Fallback,
  title,
  agent,
  openLabel,
  hideLabel,
  onOpen,
  onHide,
}: {
  top: number
  image: { uri: string; aspect: number } | null
  fallback: Icon
  title: string
  /** The agent is driving it right now, rather than the person. */
  agent: boolean
  openLabel: string
  hideLabel: string
  onOpen(): void
  onHide(): void
}) {
  const { c } = useTheme()
  const aspect = Math.min(Math.max(image?.aspect ?? 4 / 3, 0.5), 2)
  return (
    <Glass radius={radius.l} style={{ position: 'absolute', right: space.m, top, width: PREVIEW_WIDTH, zIndex: 30 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        onPress={() => {
          tap()
          onOpen()
        }}
      >
        <View style={{ width: PREVIEW_WIDTH, aspectRatio: aspect, backgroundColor: c.canvas }}>
          {image ? (
            <Image source={{ uri: image.uri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Fallback size={22} color={c.muted} strokeWidth={1.5} />
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: space.s }}>
          <View
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agent ? c.warn : c.accent }}
            accessibilityElementsHidden
          />
          <T size={font.caption} numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </T>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hideLabel}
        hitSlop={10}
        onPress={onHide}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
      >
        <X size={12} color="#ffffff" strokeWidth={2.4} />
      </Pressable>
    </Glass>
  )
}
