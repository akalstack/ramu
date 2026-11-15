import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react-native'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { ActivityPill } from './ActivityPill'

/** This thread's browser tabs, metadata only. One reader feeds the activity pill and the viewer. */
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
        const live = !!(status?.viewable ?? status?.engine)
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
    const off = io.current.subscribe(host, (...[channel]) => {
      if (['browser:changed', 'hostBrowser:changed', 'browser:present', 'hostBrowser:present'].includes(channel))
        void load()
    })
    // No poll: the host pushes every change, and a reconnect re-runs this effect (it depends on online).
    return () => {
      active = false
      off()
    }
  }, [host, task, online, viewOnly])
  return { tabs: viewOnly || !task ? [] : tabs, viewable: viewable && !viewOnly }
}

/** Sits with the computer-use bar: shows when this thread has browser tabs and opens the live view in one tap. */
export function BrowserNotice({ chat, tabs, onOpen }: { chat: Chat; tabs: BrowserTabInfo[]; onOpen(): void }) {
  const store = useStore()
  const say = useSay()
  const online = store.isOnline(chat.computerId)
  const tab = tabs[0]
  if (!chat.taskId || !tab) return null
  const agent = tabs.some((entry) => entry.controller === 'agent' && !entry.paused)
  return (
    <ActivityPill
      icon={Globe}
      label={agent ? say('Using browser') : tab.title || tab.url}
      accessibilityLabel={`${say('Open browser')}, ${tab.title || tab.url}`}
      tone={!online ? 'off' : agent ? 'attention' : 'quiet'}
      emphasis={agent}
      iconOnly={!agent}
      onPress={onOpen}
    />
  )
}
