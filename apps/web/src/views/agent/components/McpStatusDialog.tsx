import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMcpStatus } from '@ramu/shared/types'
import { Dialog } from '../../../Menu'
import { Button } from '@/components/desktop-button'
import { useHost } from '../../../workspace/HostProvider'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { AgentSetupSection } from './AgentSetupSection'

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
  const label = (value: string) => {
    switch (value) {
      case 'configured':
        return t('Configured')
      case 'unknown':
        return t('Connection status unknown')
      case 'unsupported':
        return t('Not supported by this runtime')
      case 'cancelled':
        return t('Cancelled')
      case 'connected':
        return t('Connected')
      case 'pending':
      case 'connecting':
        return t('Connecting')
      case 'failed':
        return t('Failed')
      case 'needs-auth':
        return t('Needs authentication')
      case 'disabled':
        return t('Disabled')
      default:
        return value
    }
  }
  return (
    <Dialog
      title={t('MCP servers')}
      confirmLabel={t('Close')}
      onConfirm={onClose}
      onCancel={onClose}
      error={error}
      extraActions={
        <>
          {status?.canReload && (
            <Button variant="secondary" disabled={busy} onClick={() => void reconnect()}>
              {t('Reload MCP servers')}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => void load()}>
            {t('Refresh')}
          </Button>
        </>
      }
    >
      <div aria-busy={busy}>
        {!status && busy && <p role="status">{t('Checking MCP connections…')}</p>}
        {status && !status.supported && <p>{t('This provider does not expose MCP connection status yet.')}</p>}
        {status?.supported && (
          <>
            {status.source === 'configuration' && (
              <p>{t('Showing workspace MCP configuration. This runtime does not expose live connection status.')}</p>
            )}
            {status.canReload && <p>{t('Reloaded MCP configuration applies on the next turn.')}</p>}
            {!status.live && status.source !== 'configuration' && (
              <p>{t('Last reported status. Send a message to start or reconnect this thread.')}</p>
            )}
            {!status.servers.length && <p>{t('No MCP servers reported yet. Start the thread, then refresh.')}</p>}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {status.servers.map((server) => (
                <li key={server.name} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <strong className="min-w-0 flex-1 break-words">{server.name}</strong>
                    <span>{label(server.status)}</span>
                    {status.live &&
                      status.canReconnect &&
                      (server.status === 'failed' || server.status === 'needs-auth') && (
                        <Button variant="secondary" disabled={busy} onClick={() => void reconnect(server.name)}>
                          {t('Reconnect')}
                        </Button>
                      )}
                  </div>
                  {server.toolCount !== undefined && <span>{t('{0} tools', { '0': server.toolCount })}</span>}
                  {server.status === 'needs-auth' && (
                    <p>{t('Authenticate this server in your provider, then refresh.')}</p>
                  )}
                  {server.error && <p className="break-words text-bad">{server.error}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
        <AgentSetupSection sessionId={sessionId} />
      </div>
    </Dialog>
  )
}
