import { useEffect, useRef, useState } from 'react'
import { Pressable } from 'react-native'
import { ChevronRight, Globe } from 'lucide-react-native'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, radius, space, useTheme } from '../theme'
import { T } from './ui'

/** Sits with the computer-use bar: shows when this thread has browser tabs and opens the live view in one tap. */
export function BrowserNotice({ chat, onOpen }: { chat: Chat; onOpen(): void }) {
  const store = useStore()
  const { c } = useTheme()
  const io = useRef(store)
  io.current = store
  const host = chat.computerId
  const task = chat.taskId
  const online = store.isOnline(host)
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  useEffect(() => {
    if (!task || !online) return
    let active = true
    const load = async () => {
      try {
        const status = await io.current.invoke(host, 'hostBrowser.status').catch(() => null)
        const listed =
          (status?.viewable ?? status?.enabled)
            ? await io.current.invoke(host, 'hostBrowser.list', task)
            : (await io.current.invoke(host, 'browser.activity', task)).tabs
        if (active) setTabs(listed)
      } catch {
        // Metadata only: keep the last known bar rather than flashing it away on a missed read.
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
  }, [host, task, online])
  const tab = tabs[0]
  if (!task || !tab) return null
  const id = store.language === 'id'
  const agent = tabs.some((entry) => entry.controller === 'agent' && !entry.paused)
  const label = agent ? (id ? 'Menggunakan browser' : 'Using browser') : id ? 'Browser' : 'Browser'
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
