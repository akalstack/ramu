import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Lightbulb } from 'lucide-react'
import { RECOMMENDED_MCP_SERVERS, recommendedConnection } from '@ramu/shared/mcpCatalog'
import type { SharedMcpConnection } from '@ramu/shared/mcp'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { mcpLogins } from '@ramu/shared/toolSync'
import { reasonCopy, type ToolSuggestionView } from '@ramu/shared/toolSuggestions'
import { Button } from '@/components/desktop-button'
import { BrandIcon } from '@/components/brand-icon'
import { brandOf } from '../../../customize/parts'
import { openCustomize, reviewPluginInstall, reviewSkillInstall } from '../../../customize/openCustomize'
import { ipcQueryKeyOn } from '../../../dataQueries'
import { queryInvokerFor } from '../../../git/hostQuery'
import { t, useLanguage } from '../../../i18n'
import { ramu } from '../../../ipc'
import { errorText } from '../../../lib/errors'
import { useAppSettings } from '../../../settings/AppSettings'
import { useHost } from '../../../workspace/HostProvider'
import { useHostRuntime } from '../../../workspace/workspace'

/**
 * A tool Ramu suggests from what this thread did: what it does, why, and the way to turn it on here or everywhere.
 * Turning it on is Customize's own path, so a plugin opens its install review and a server asks for its sign-in.
 */
export function ToolSuggestionCard({ cardId }: { cardId: string }) {
  useLanguage()
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const { on } = useHostRuntime()
  const query = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'toolSuggestions.get', cardId),
    queryFn: () => call('toolSuggestions.get', cardId),
  })
  const { refetch } = query
  useEffect(() => {
    // Turning the tool on in Customize, here or on another device, changes what the card shows.
    const stops = (['workspace:changed', 'plugins:changed', 'mcp:changed'] as const).map((channel) =>
      on(channel, () => void refetch()),
    )
    return () => stops.forEach((stop) => stop())
  }, [on, refetch])
  return query.data ? <Suggestion view={query.data} onChange={() => void refetch()} /> : null
}

function Suggestion({ view, onChange }: { view: ToolSuggestionView; onChange: () => void }) {
  const { invoke } = useHost()
  const { preferences } = useAppSettings()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { card, status, canTurnOn, canAnswer } = view
  const server =
    card.tool.kind === 'mcp' ? RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === card.tool.name) : null
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
      onChange()
    }
  }
  /** Gives the server to every signed-in login, as Customize does once a server is added. */
  const giveToAgents = async (connection: Pick<SharedMcpConnection, 'id' | 'providers'>) => {
    const logins = mcpLogins(preferences, connection)
    if (!logins.length) throw new Error(t('Sign in to an agent first, then turn this on again.'))
    await invoke('mcp.turnOn', connection.id, logins)
  }
  const turnOn = (projectId: string | null) =>
    run(async () => {
      if (card.tool.kind === 'plugin') {
        reviewPluginInstall(card.tool.index, card.tool.name, projectId ?? undefined)
        return
      }
      if (card.tool.kind === 'skill') {
        reviewSkillInstall(card.tool.source, card.tool.name, projectId ?? undefined)
        return
      }
      if (!server) throw new Error(t('Ramu no longer lists this server.'))
      const saved = await invoke('mcp.save', recommendedConnection(server, projectId, [...AGENT_PROVIDERS]))
      // A server that signs in can't list its tools yet; the card offers Sign in next.
      await giveToAgents(saved).catch((reason) => {
        if (!server.signIn) throw reason
      })
    })
  const signIn = (connectionId: string) =>
    run(async () => {
      const started = await invoke('mcp.signIn', connectionId)
      if (started) await ramu.invoke('app.openExternal', started.url)
    })
  const finish = (connectionId: string) =>
    run(async () => {
      const connection = (await invoke('mcp.status')).connections.find(
        (entry) => entry.connection.id === connectionId,
      )?.connection
      if (!connection) throw new Error(t('That MCP server is no longer here.'))
      await giveToAgents(connection)
    })
  const reason = reasonCopy(card.reason)
  // The agent's suggestion says where it thinks the tool belongs; that choice is the card's main button.
  const everywhereFirst = card.reason.kind === 'agent' && card.reason.scope === 'everywhere'
  const brand = brandOf(card.tool.name)
  const elsewhere = t('Turn it on in Customize on the computer running Ramu.')
  return (
    <section
      className="m-[12px_0] flex flex-col gap-2 rounded-(--radius-m) bg-fill p-[15px]"
      aria-label={t('Suggested tool')}
    >
      <div className="flex min-w-0 items-center gap-2">
        {brand ? (
          <BrandIcon brand={brand} size={16} className="flex-none" />
        ) : (
          <Lightbulb size={16} className="flex-none" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{card.title}</span>
        <span className="flex flex-none items-center gap-1 text-caption text-muted-foreground">
          {status.state === 'on' && <Check size={13} aria-hidden="true" />}
          {status.state === 'on'
            ? t('On')
            : status.state === 'dismissed'
              ? t('Hidden for this project')
              : t('Suggested tool')}
        </span>
      </div>
      {card.description && <p className="m-0 text-control text-soft">{card.description}</p>}
      <p className="m-0 text-caption text-muted-foreground [overflow-wrap:anywhere]">{t(reason.text, reason.values)}</p>
      {status.state === 'sign-in' && (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Sign in to {0} to finish turning it on.', { 0: card.title })}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-caption text-bad [overflow-wrap:anywhere] whitespace-pre-wrap">
          {error}
        </p>
      )}
      {canAnswer && !canTurnOn && status.state !== 'on' && status.state !== 'dismissed' && (
        <p className="m-0 text-caption text-muted-foreground">{elsewhere}</p>
      )}
      {canAnswer && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {status.state === 'open' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => invoke('toolSuggestions.dismiss', card.id))}
            >
              {t('Not now')}
            </Button>
          )}
          {canTurnOn && status.state === 'open' && (
            <>
              <Button
                variant={everywhereFirst ? 'default' : 'secondary'}
                size="sm"
                disabled={busy}
                onClick={() => void turnOn(null)}
              >
                {t('Turn on everywhere')}
              </Button>
              <Button
                variant={everywhereFirst ? 'secondary' : 'default'}
                size="sm"
                disabled={busy}
                onClick={() => void turnOn(card.projectId)}
              >
                {t('Turn on for this project')}
              </Button>
            </>
          )}
          {canTurnOn && status.state === 'sign-in' && (
            <Button variant="default" size="sm" disabled={busy} onClick={() => void signIn(status.connectionId)}>
              {t('Sign in')}
            </Button>
          )}
          {canTurnOn && status.state === 'added' && (
            <Button variant="default" size="sm" disabled={busy} onClick={() => void finish(status.connectionId)}>
              {t('Turn on')}
            </Button>
          )}
          {canTurnOn && status.state === 'needs-setup' && (
            <Button
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => openCustomize('plugins', status.pluginId)}
            >
              {t('Finish setup')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
