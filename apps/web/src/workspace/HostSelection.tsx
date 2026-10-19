import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { invokerFor } from '../ipc'
import { ownHostId } from '../hosts'
import { notifyError } from '../chat/Notifications'
import { t } from '../i18n'
import { openSummary } from '../summaries/openSummary'
import { useComputers } from './computers'
import { applyDestination, needsRefresh, routeSelection } from './selectionRoute'
import { publishedStore, requestHostStore, subscribePublished } from './workspace'

interface HostSelection {
  /** The host whose store is on screen. */
  activeHost: string
  /** Opens a thread, project or page on a host: in the existing shell. */
  select(host: string, destination: HostDestination): void
}

const Context = createContext<HostSelection | null>(null)

export function useHostSelection(): HostSelection {
  const selection = useContext(Context)
  if (!selection) throw new Error('HostSelectionProvider missing')
  return selection
}

/** A host store that has not loaded this long after being selected is given up on (it went offline meanwhile). */
const SWITCH_TIMEOUT_MS = 15_000

/**
 * Holds the selection's host and applies destinations to the store that owns them. Renders `children` with the host
 * on screen, which `WorkspaceProvider` takes as `activeHost`. Each host retains its workspace store while another comes on screen.
 */
export function HostSelectionProvider({ children }: { children: (activeHost: string) => ReactNode }) {
  const own = ownHostId()
  const computers = useComputers()
  const [activeHost, setActiveHost] = useState(own)
  const [pending, setPending] = useState<{
    seq: number
    host: string
    destination: HostDestination
    refreshed: boolean
  } | null>(null)
  const early = useRef<{ host: string; destination: HostDestination } | null>(null)
  const sequence = useRef(0)
  const refreshing = useRef<number | null>(null)
  const latest = useRef({ activeHost, computers })
  latest.current = { activeHost, computers }

  const select = useCallback((host: string, destination: HostDestination) => {
    const current = latest.current
    const status = current.computers?.computers.find((computer) => computer.id === host)?.status ?? null
    const route = routeSelection({
      host,
      active: current.activeHost,
      ready: !!current.computers,
      status,
    })
    if (route === 'pending') {
      early.current = { host, destination }
      return
    }
    if (route === 'unavailable') {
      notifyError(
        t('{name} is not reachable right now.', {
          name: current.computers?.computers.find((computer) => computer.id === host)?.name ?? host,
        }),
        t('Hosts'),
      )
      return
    }
    if (route === 'switch') requestHostStore(host)
    setPending({ seq: ++sequence.current, host, destination, refreshed: !needsRefresh(destination) })
  }, [])

  // A startup notification can precede the first host-list response. Retain its destination until routing is known.
  useEffect(() => {
    if (!computers || !early.current) return
    const next = early.current
    early.current = null
    select(next.host, next.destination)
  }, [computers, select])

  // Re-run when the selected host's store loads or changes, so a destination waits for it.
  const target = useSyncExternalStore(subscribePublished, () => (pending ? publishedStore(pending.host) : null))
  useEffect(() => {
    if (!pending) return
    // Read at run time: the store published in this commit's layout effects is newer than the render's snapshot.
    const store = publishedStore(pending.host)
    if (!store) return
    if (!pending.refreshed) {
      if (refreshing.current === pending.seq) return
      refreshing.current = pending.seq
      const seq = pending.seq
      void store
        .refresh()
        .catch(() => {})
        .then(() => setPending((current) => (current?.seq === seq ? { ...current, refreshed: true } : current)))
      return
    }
    setPending(null)
    if (pending.host !== activeHost) setActiveHost(pending.host)
    if (
      !applyDestination(store, pending.destination, {
        openSummary: (id) => openSummary(id, invokerFor(pending.host), pending.host),
      })
    )
      notifyError(t('Thread not found'))
  }, [pending, target, activeHost])

  // Switching to a host whose store never loads (it went offline) gives up instead of waiting forever.
  useEffect(() => {
    if (!pending || pending.host === activeHost) return
    const seq = pending.seq
    const timer = setTimeout(() => {
      setPending((current) => (current?.seq === seq ? null : current))
      const name = latest.current.computers?.computers.find((computer) => computer.id === pending.host)?.name
      notifyError(t('{name} is not reachable right now.', { name: name ?? pending.host }), t('Hosts'))
    }, SWITCH_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pending, activeHost])

  // A host that is forgotten cannot stay on screen.
  useEffect(() => {
    if (activeHost !== own && computers && !computers.computers.some((computer) => computer.id === activeHost))
      setActiveHost(own)
  }, [computers, activeHost, own])

  const value = useMemo(() => ({ activeHost, select }), [activeHost, select])
  return <Context.Provider value={value}>{children(activeHost)}</Context.Provider>
}
