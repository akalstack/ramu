import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import { useStore } from './store'

type Sessions = Record<string, (ComputerSessionSummary & { threadId: string })[]>
const Context = createContext<{ sessions: Sessions; refresh(host: string): Promise<void> } | null>(null)

/** One metadata poll per connected owner host, shared by every visible thread row. Never captures a screen. */
export function ComputerUseProvider({ children }: { children: ReactNode }) {
  const store = useStore()
  const io = useRef(store)
  io.current = store
  const [sessions, setSessions] = useState<Sessions>({})
  const hosts = store.computers
    .filter((host) => host.status === 'online' && host.access !== 'viewer')
    .map((host) => host.id)
  const key = JSON.stringify(hosts)
  const refresh = useCallback(async (host: string) => {
    const next = await io.current.invoke(host, 'computer.sessions')
    setSessions((previous) =>
      JSON.stringify(previous[host]) === JSON.stringify(next) ? previous : { ...previous, [host]: next },
    )
  }, [])
  const value = useMemo(() => ({ sessions, refresh }), [sessions, refresh])
  useEffect(() => {
    let active = true
    const pending = new Set<string>()
    const load = async () => {
      if (AppState.currentState !== 'active') return
      await Promise.all(
        hosts.map(async (host) => {
          if (pending.has(host)) return
          pending.add(host)
          try {
            const next = await io.current.invoke(host, 'computer.sessions')
            if (active)
              setSessions((previous) =>
                JSON.stringify(previous[host]) === JSON.stringify(next) ? previous : { ...previous, [host]: next },
              )
          } catch {
            /* Older/offline hosts do not advertise access they cannot confirm. */
          } finally {
            pending.delete(host)
          }
        }),
      )
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load()
    })
    return () => {
      active = false
      clearInterval(timer)
      subscription.remove()
    }
    // Only connection membership restarts polling; the current store stays in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useComputerUse(host: string, thread: string) {
  const context = useContext(Context)
  return {
    session: context?.sessions[host]?.find((session) => session.threadId === thread),
    refresh: () => context?.refresh(host),
  }
}
