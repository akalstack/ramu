import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { reviewSelection, type NearbyHost, type NearbyHostsState } from '@ramu/shared/discovery/tracker'
import { Button } from '@/components/desktop-button'
import { Dropdown } from '../Menu'
import { invoke } from '../ipc'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

const POLL_MS = 1500

/** `192.168.1.20:7788`, `[fd00::20]:7788`: what a person recognises, without the scheme. */
const shown = (url: string) => url.replace(/^https?:\/\//, '')

/**
 * Hosts on this computer's networks that chose to be found. Browsing runs on this computer (the main process), starts
 * when this panel shows, and stops when it hides, the window is in the background, or a different method is chosen.
 * Choosing a host only fills the address; pairing still needs the host's code.
 */
export function NearbyHosts({
  onChoose,
  onFallback,
}: {
  /** Fills the pairing form with the reviewed address and the host's name. */
  onChoose: (host: NearbyHost, url: string) => void
  /** Switches to entering an address or an SSH host, which stay reachable in every state. */
  onFallback: (method: 'link' | 'ssh') => void
}) {
  useLanguage()
  const [state, setState] = useState<NearbyHostsState>({ status: 'searching', hosts: [], timedOut: false })
  const [failed, setFailed] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ key: string; url: string } | null>(null)
  const live = useRef(true)

  const start = useCallback(() => {
    setFailed(null)
    setState((current) => ({ ...current, status: 'searching', timedOut: false }))
    invoke('computers.discovery.start').then(
      (next) => live.current && setState(next),
      (error) => live.current && setFailed(errorText(error)),
    )
  }, [])

  useEffect(() => {
    live.current = true
    let timer: ReturnType<typeof setInterval> | undefined
    const poll = () =>
      invoke('computers.discovery.state').then(
        (next) => live.current && setState(next),
        () => {},
      )
    const run = () => {
      start()
      timer = setInterval(() => void poll(), POLL_MS)
    }
    const halt = () => {
      clearInterval(timer)
      timer = undefined
      void invoke('computers.discovery.stop').then(
        (next) => live.current && setState(next),
        () => {},
      )
    }
    // A hidden window stops listening; coming back searches again.
    const visibility = () => (document.hidden ? halt() : timer === undefined && run())
    if (!document.hidden) run()
    document.addEventListener('visibilitychange', visibility)
    return () => {
      live.current = false
      document.removeEventListener('visibilitychange', visibility)
      clearInterval(timer)
      void invoke('computers.discovery.stop').catch(() => {})
    }
  }, [start])

  const hosts = state.hosts
  const review = reviewSelection(hosts, selected?.key ?? null, selected?.url ?? null)
  const current = hosts.find((host) => host.key === selected?.key)
  const routeOptions = (current?.routes ?? []).map((route) => ({
    value: route.url,
    label: route.interfaceName ? `${shown(route.url)} · ${route.interfaceName}` : shown(route.url),
  }))

  const message =
    state.status === 'denied'
      ? t(
          'Ramu cannot listen on the local network. Allow Local Network access for Ramu in your system settings, then search again. You can still enter an address or use SSH.',
        )
      : state.status === 'unavailable' || failed
        ? t('Nearby discovery is not available on this network or computer. Enter an address or use SSH.')
        : state.status === 'searching' && !hosts.length
          ? t('Searching for hosts on this network…')
          : state.timedOut && !hosts.length
            ? t('Stopped searching after a while. Search again, enter an address or use SSH.')
            : !hosts.length
              ? t(
                  'No hosts found. That does not mean none exist: a host appears here only when it has Discoverable on this network turned on, and some networks block discovery. Enter an address or use SSH instead.',
                )
              : null

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Hosts on this network that chose to be found. Selecting one fills in its address; you still need a pairing code from that host.',
        )}
      </p>
      <p role="status" aria-live="polite" className="m-0 text-caption text-muted-foreground">
        {message}
      </p>
      {hosts.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('Nearby hosts')}>
          {hosts.map((host) => {
            const route = host.routes[0]
            const active = selected?.key === host.key
            return (
              <li key={host.key}>
                <button
                  type="button"
                  aria-pressed={active}
                  className={`flex w-full items-center gap-3 rounded-(--radius-s) border-0 p-2 text-left ${active ? 'bg-hover' : 'bg-transparent hover:bg-hover'}`}
                  onClick={() => route && setSelected({ key: host.key, url: route.url })}
                >
                  <Monitor size={16} className="flex-none text-muted-foreground" />
                  <span className="min-w-0 grow">
                    <span className="block truncate text-body font-medium">{host.label}</span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {route ? shown(route.url) : ''}
                      {host.scheme === 'http' ? ` · ${t('Not encrypted')}` : ''}
                      {host.pairedHostId ? ` · ${t('Already paired')}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected && current && (
        <div
          className="flex flex-col gap-2 rounded-(--radius-s) bg-background/40 p-3"
          role="group"
          aria-label={current.label}
        >
          {review === 'changed' && (
            <p role="alert" className="m-0 text-caption text-warn">
              {t('Its address changed. Review the new one before continuing.')}
            </p>
          )}
          {routeOptions.length > 1 && (
            <Dropdown
              label={t('Address')}
              value={routeOptions.some((option) => option.value === selected.url) ? selected.url : ''}
              placeholder={t('Choose an address')}
              options={routeOptions}
              onChange={(url) => setSelected({ key: selected.key, url })}
            />
          )}
          {current.scheme === 'http' && (
            <p className="m-0 text-caption text-muted-foreground">
              {t('This host does not encrypt the connection. Pair only on a network you trust.')}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              variant="default"
              disabled={!routeOptions.some((option) => option.value === selected.url)}
              onClick={() => onChoose(current, selected.url)}
            >
              {t('Continue with {0}', { 0: current.label })}
            </Button>
          </div>
        </div>
      )}
      {selected && !current && (
        <p role="alert" className="m-0 text-caption text-warn">
          {t('That host is no longer visible. Pick another or enter its address.')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={start}>
          <RefreshCw size={14} />
          {t('Search again')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onFallback('link')}>
          {t('Enter an address')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onFallback('ssh')}>
          {t('Use SSH')}
        </Button>
      </div>
    </div>
  )
}
