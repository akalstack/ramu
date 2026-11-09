import { useCallback, useEffect, useRef, useState } from 'react'
import { mcpStatusLabel } from '@ramu/shared/mcp'
import type { AgentMcpStatus } from '@ramu/shared/types'
import { Dialog } from '../../../Menu'
import { Button } from '@/components/desktop-button'
import { RefreshCw, Settings } from 'lucide-react'
import { useHost } from '../../../workspace/HostProvider'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { AgentSetupSection } from './AgentSetupSection'

/** An empty or unsupported state, in the same dashed panel Settings uses for an empty list. */
const EMPTY =
  'm-0 rounded-(--radius-m) border border-dashed border-(--line) px-3 py-4 text-center text-caption text-muted-foreground'

/** A server's state at a glance: ready, waiting on the person, broken, or nothing to say yet. */
const dot = (status: string) =>
  status === 'connected'
    ? 'bg-(--ok)'
    : status === 'needs-auth' || status === 'pending' || status === 'connecting'
      ? 'bg-(--warn)'
      : status === 'failed'
        ? 'bg-(--bad)'
        : 'bg-(--line-strong)'

export function McpStatusDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  useLanguage()
  const { invoke } = useHost()
  const [status, setStatus] = useState<AgentMcpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const load = useCallback(async () => {
    const request = ++revision.current
    setBusy(true)
    setError(null)
    try {
      const next = await invoke('agent.mcpStatus', sessionId)
      if (revision.current === request) setStatus(next)
    } catch (reason) {
      if (revision.current === request) setError(errorText(reason))
    } finally {
      if (revision.current === request) setBusy(false)
    }
  }, [invoke, sessionId])
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  useEffect(() => {
    void load()
    return invalidate
  }, [load, invalidate])
  const reconnect = async (name?: string) => {
    const request = ++revision.current
    setBusy(true)
    setError(null)
    try {
      if (name === undefined) await invoke('agent.reloadMcp', sessionId)
      else await invoke('agent.reconnectMcp', sessionId, name)
      if (revision.current === request) await load()
    } catch (reason) {
      if (revision.current === request) setError(errorText(reason))
    } finally {
      if (revision.current === request) setBusy(false)
    }
  }
  const label = (value: string) => t(mcpStatusLabel(value))
  // What the status can and cannot tell, said once in a quiet line instead of a paragraph per caveat.
  const notes = status?.supported
    ? [
        status.source === 'configuration'
          ? t('Showing workspace MCP configuration. This runtime does not expose live connection status.')
          : !status.live
            ? t('Last reported status. Send a message to start or reconnect this thread.')
            : null,
        status.canReload ? t('Reloaded MCP configuration applies on the next turn.') : null,
      ].filter((note): note is string => Boolean(note))
    : []
  return (
    <Dialog
      title={t('MCP servers')}
      confirmLabel={t('Close')}
      cancellable={false}
      onConfirm={onClose}
      onCancel={onClose}
      error={error}
      footerLeading={
        <Button
          variant="ghost"
          className="mr-auto"
          onClick={() => {
            onClose()
            window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'agent-setup' } }))
          }}
        >
          <Settings size={14} />
          {t('Agent setup')}
        </Button>
      }
      extraActions={
        <>
          {status?.canReload && (
            <Button variant="secondary" disabled={busy} onClick={() => void reconnect()}>
              {t('Reload MCP servers')}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />
            {t('Refresh')}
          </Button>
        </>
      }
    >
      <div aria-busy={busy} className="flex flex-col gap-3">
        {!status && busy && (
          <p role="status" className="m-0 text-caption text-muted-foreground">
            {t('Checking MCP connections…')}
          </p>
        )}
        {status && !status.supported && (
          <p className={EMPTY}>{t('This provider does not expose MCP connection status yet.')}</p>
        )}
        {status?.supported && (
          <>
            {notes.length > 0 && <p className="m-0 text-caption text-muted-foreground">{notes.join(' ')}</p>}
            {!status.servers.length ? (
              <p className={EMPTY}>{t('No MCP servers reported yet. Start the thread, then refresh.')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col overflow-hidden rounded-(--radius-m) bg-fill p-0">
                {status.servers.map((server) => (
                  <li
                    key={server.name}
                    className="flex flex-col gap-1 px-3 py-2.5 [&+&]:border-t [&+&]:border-(--line)"
                  >
                    <div className="flex items-center gap-2.5">
                      <span aria-hidden className={`size-2 flex-none rounded-full ${dot(server.status)}`} />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate font-medium text-foreground">{server.name}</strong>
                        <span className="block text-caption text-muted-foreground">
                          {label(server.status)}
                          {server.toolCount !== undefined && ` · ${t('{0} tools', { '0': server.toolCount })}`}
                        </span>
                      </span>
                      {status.live &&
                        status.canReconnect &&
                        (server.status === 'failed' || server.status === 'needs-auth') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void reconnect(server.name)}
                          >
                            {t('Reconnect')}
                          </Button>
                        )}
                    </div>
                    {server.status === 'needs-auth' && (
                      <p className="m-0 pl-[18px] text-caption text-muted-foreground">
                        {t('Authenticate this server in your provider, then refresh.')}
                      </p>
                    )}
                    {server.error && <p className="m-0 pl-[18px] text-caption break-words text-bad">{server.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <AgentSetupSection sessionId={sessionId} />
      </div>
    </Dialog>
  )
}
