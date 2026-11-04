import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import type { Chat } from './types'

/** Metadata only: never opens a tab, grants a computer, or starts a terminal. */
export function useThreadToolActivity(chat: Chat | undefined, visible: boolean) {
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const host = chat?.computerId
  const task = chat?.taskId
  const session = chat?.sessionId
  const scope = `${host}:${task}:${session}`
  const online = !!host && store.isOnline(host)
  const [reading, setReading] = useState({ scope, browser: false, computer: false, terminal: false, usage: false })
  useEffect(() => {
    if (!host || !task || !visible || !online) return
    let active = true,
      loading = false
    const load = async () => {
      if (loading) return
      loading = true
      const browser = async () => {
        const status = await io.current.invoke(host, 'hostBrowser.status').catch(() => null)
        return status?.enabled
          ? (await io.current.invoke(host, 'hostBrowser.list', task)).length > 0
          : (await io.current.invoke(host, 'browser.activity', task)).tabs.length > 0
      }
      const results = await Promise.allSettled([
        browser(),
        io.current.invoke(host, 'computer.session', task).then(Boolean),
        io.current.invoke(host, 'term.list', task).then((rows) => rows.some((row) => !row.exited && !row.background)),
        session ? io.current.invoke(host, 'agent.context', session).then(Boolean) : Promise.resolve(false),
      ])
      loading = false
      if (!active) return
      setReading((previous) => {
        const old =
          previous.scope === scope ? previous : { browser: false, computer: false, terminal: false, usage: false }
        const value = (index: number, fallback: boolean) => {
          const result = results[index]
          return result?.status === 'fulfilled' ? result.value : fallback
        }
        return {
          scope,
          browser: value(0, old.browser),
          computer: value(1, old.computer),
          terminal: value(2, old.terminal),
          usage: value(3, old.usage),
        }
      })
    }
    void load()
    const unwatch = session ? io.current.watch(host, ['context:changed'], { 'context:changed': [session] }) : () => {}
    const off = io.current.subscribe(host, (...[channel]) => {
      if (
        [
          'browser:changed',
          'hostBrowser:changed',
          'browser:present',
          'hostBrowser:present',
          'term:changed',
          'context:changed',
        ].includes(channel)
      )
        void load()
    })
    // No poll, as in T3 Code: the host pushes every change, and a reconnect re-runs this effect (it depends on online).
    return () => {
      active = false
      off()
      unwatch()
    }
  }, [host, task, session, scope, online, visible])
  return reading.scope === scope ? reading : { scope, browser: false, computer: false, terminal: false, usage: false }
}
