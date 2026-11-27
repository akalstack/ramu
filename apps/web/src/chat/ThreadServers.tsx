import { useQuery } from '@tanstack/react-query'
import { Server, Square, Unplug } from 'lucide-react'
import { serverUrl, type ThreadServer } from '@ramu/shared/servers'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { ComposerTraySection, TRAY_LIST_CLASS } from '../composer/ComposerTraySection'
import { ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { useComputers } from '../workspace/computers'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'
import { notifyError } from './Notifications'

const POLL_MS = 3000

/** The servers a thread's work is listening on, read only while its chat is on screen. */
export function useThreadServers(taskId: string | undefined, visible = true) {
  const { id: hostId, invoke, status } = useHost()
  const query = useQuery({
    queryKey: ['servers', hostId, taskId],
    queryFn: () => invoke('servers.list', taskId),
    enabled: !!taskId && visible && status === 'connected',
    refetchInterval: POLL_MS,
    retry: false,
  })
  // Build daemons are not servers to open; Resources lists them, and Ramu stops them once the thread rests.
  const servers = (query.data ?? []).filter((server) => !server.daemon)
  const stop = async (server: ThreadServer) => {
    try {
      await invoke('servers.stop', server.taskId, server.pid, server.port)
    } catch (error) {
      notifyError(errorText(error))
    }
    void query.refetch()
  }
  return { hostId, servers, stop }
}

/** Opens a server in the thread's browser pane; with ⌘ or Ctrl, in the person's own browser when the host is this device. */
export function useOpenServer(hostId: string) {
  const ws = useWorkspace()
  const local = useComputers()?.current === hostId
  return {
    local,
    open: (server: ThreadServer, external: boolean) => {
      const url = serverUrl(server)
      if (external && local) void ramu.invoke('app.openExternal', url).catch((error) => notifyError(errorText(error)))
      else ws.openView(server.taskId, { kind: 'browser', url })
    },
  }
}

/** What started it and what it runs, such as "npm run dev · node". */
export const serverOrigin = (server: ThreadServer) =>
  [server.owner.kind === 'agent' ? t('Agent') : server.owner.name, server.process].filter(Boolean).join(' · ')

export function ServerRow({
  server,
  local,
  onOpen,
  onStop,
}: {
  server: ThreadServer
  local: boolean
  onOpen: (server: ThreadServer, external: boolean) => void
  onStop: (server: ThreadServer) => void
}) {
  const address = serverUrl(server).replace('http://', '')
  return (
    <li className="group flex min-h-8 items-center gap-2 text-control">
      <RowButton
        size="sm"
        className="w-auto flex-1 min-w-0 gap-2 px-1.5 py-1"
        disabled={!server.web}
        title={
          server.web
            ? local
              ? t('Open in the browser pane. ⌘-click for your browser.')
              : t('Open in the browser pane.')
            : t('Not a web page')
        }
        onClick={(event) => onOpen(server, event.metaKey || event.ctrlKey)}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen(server, true)
        }}
      >
        {server.web ? (
          <Server size={14} className="flex-none text-muted-foreground" />
        ) : (
          <Unplug size={14} className="flex-none text-muted-foreground" />
        )}
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="w-full truncate text-foreground tabular-nums">{address}</span>
          <span className="w-full truncate text-caption text-muted-foreground">
            {serverOrigin(server)}
            {server.orphaned && <span className="text-warn"> · {t('Outlived what started it')}</span>}
          </span>
        </span>
      </RowButton>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-bad"
        aria-label={t('Stop {0}', { 0: address })}
        title={t('Stop server')}
        onClick={() => onStop(server)}
      >
        <Square size={11} fill="currentColor" />
      </Button>
    </li>
  )
}

/** The thread's servers as a tray section, beside its background terminals; shown while there are some. */
export function ThreadServersSection({ state }: { state: ReturnType<typeof useThreadServers> }) {
  useLanguage()
  const { local, open } = useOpenServer(state.hostId)
  return (
    <ComposerTraySection aria-label={t('Servers')} title={t('Servers')} count={state.servers.length} icon={<Server />}>
      <ul className={TRAY_LIST_CLASS}>
        {state.servers.map((server) => (
          <ServerRow
            key={`${server.pid}:${server.port}`}
            server={server}
            local={local}
            onOpen={open}
            onStop={(entry) => void state.stop(entry)}
          />
        ))}
      </ul>
    </ComposerTraySection>
  )
}
