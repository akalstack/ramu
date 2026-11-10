import { useCallback, useEffect, useState } from 'react'
import { Globe, Plus, Puzzle, RefreshCw, SquareTerminal } from 'lucide-react'
import { RECOMMENDED_MCP_SERVERS, type RecommendedMcpServer } from '@ramu/shared/mcpCatalog'
import { CLAUDE_PLUGIN_INDEX } from '@ramu/shared/plugins'
import {
  defaultToolChoice,
  type SharedMcpConnection,
  type SharedMcpInspection,
  type SharedMcpManagement,
  type SharedMcpToolChoice,
} from '@ramu/shared/mcp'
import { AGENT_PROVIDERS, providerAccountRows, providerEnabled, providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, Menu } from '../Menu'
import { ramu } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useAppSettings } from '../settings/AppSettings'
import { ConnectionEditor, McpSettings, type Definition } from '../settings/McpSettings'
import { errorText } from '../lib/errors'
import { openCustomize, reviewPluginInstall } from './openCustomize'
import { t, useLanguage } from '../i18n'
import {
  Advanced,
  brandOf,
  CustomizeHeader,
  displayName,
  ExtensionGrid,
  ExtensionItem,
  Quiet,
  SectionTitle,
} from './parts'

type Entry = SharedMcpManagement['connections'][number]

const iconOf = (connection: SharedMcpConnection) =>
  connection.transport.type === 'http' ? <Globe size={16} /> : <SquareTerminal size={16} />

/**
 * MCP servers: each one is turned on for every agent in one step (checked once, every login given its tools), with
 * each tool asking on every call unless the person lets it run. Recommended servers add in one click.
 */
export function McpSection({ open: requested }: { open?: { id: string } | null }) {
  useLanguage()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const [status, setStatus] = useState<(SharedMcpManagement & { canAdminister: boolean }) | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SharedMcpConnection | 'new' | null>(null)
  const [signingIn, setSigningIn] = useState<string | null>(null)
  useEffect(() => {
    if (requested) setOpenId(requested.id)
  }, [requested])
  const load = useCallback(() => {
    void invoke('mcp.status').then(setStatus, (reason) => setError({ id: 'page', text: errorText(reason) }))
  }, [invoke])
  useEffect(() => {
    load()
    void invoke('projects.list').then(setProjects, () => {})
    return on('mcp:changed', () => {
      setSigningIn(null)
      load()
    })
  }, [load, invoke, on])
  /** Every signed-in login of each agent the server is offered to. */
  const loginsFor = (connection: SharedMcpConnection) =>
    connection.providers
      .filter((provider) => providerEnabled(preferences.providerBinaries, provider))
      .flatMap((provider) =>
        providerAccountRows(preferences.providerBinaries, provider).map((accountId) => ({ provider, accountId })),
      )
  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError({ id, text: errorText(reason) })
    } finally {
      setBusy(null)
      load()
    }
  }
  const turnOn = (connection: SharedMcpConnection, choices?: Record<string, SharedMcpToolChoice>) =>
    act(connection.id, () => invoke('mcp.turnOn', connection.id, loginsFor(connection), choices))
  const signIn = (connection: SharedMcpConnection) =>
    act(connection.id, async () => {
      const started = await invoke('mcp.signIn', connection.id)
      if (started) {
        setSigningIn(connection.id)
        await ramu.invoke('app.openExternal', started.url)
      }
    })
  const add = (definition: Definition) =>
    act('new', async () => {
      const saved = await invoke('mcp.save', definition)
      setEditing(null)
      // A server is useful only once it is on; a sign-in it needs is asked for next.
      await invoke('mcp.turnOn', saved.id, loginsFor(saved)).catch(() => {})
      setOpenId(saved.id)
    })
  const addRecommended = (server: RecommendedMcpServer) =>
    add({
      name: server.name,
      serviceAccountId: 'public',
      enabled: true,
      scope: { hostWide: true, projectIds: [] },
      providers: [...AGENT_PROVIDERS],
      transport: { type: 'http', url: server.url, headerSecretRefs: {} },
    })
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const fits = (text: string) => words.every((word) => text.toLowerCase().includes(word))
  const connections = (status?.connections ?? []).filter(
    (entry) =>
      !entry.connection.split &&
      fits(
        `${entry.connection.name} ${entry.connection.transport.type === 'http' ? entry.connection.transport.url : entry.connection.transport.command}`,
      ),
  )
  // By address without its query, so a plugin's copy of a server (`?utm_source=plugin`) counts as added too.
  const address = (url: string) => url.split('?')[0]!.replace(/\/$/, '')
  const added = new Set(
    (status?.connections ?? []).map((entry) =>
      entry.connection.transport.type === 'http' ? address(entry.connection.transport.url) : '',
    ),
  )
  const recommended = RECOMMENDED_MCP_SERVERS.filter(
    (server) => !added.has(address(server.url)) && fits(`${server.name} ${server.description}`),
  )
  const canAdminister = status?.canAdminister === true
  const open = status?.connections.find((entry) => entry.connection.id === openId) ?? null
  const describe = (entry: Entry) => {
    const agents = [...new Set((entry.granted ?? []).map((login) => login.provider))]
    if (entry.status === 'disabled') return t('Off')
    if (entry.status === 'sign-in-required' || entry.status === 'insufficient-permission') return t('Sign in to use it')
    if (entry.status === 'failed' || entry.status === 'unsupported') return entry.reason ?? t('Could not connect')
    if (agents.length)
      return [
        agents.length === AGENT_PROVIDERS.length ? t('On for every agent') : agents.map(providerName).join(', '),
        entry.toolCount ? t('{0} tools', { '0': entry.toolCount }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    return t('Not on yet')
  }
  const action = (entry: Entry) => {
    const { connection } = entry
    if (busy === connection.id)
      return <RefreshCw size={15} className="animate-spin text-muted-foreground" aria-label={t('Working…')} />
    if (entry.status === 'disabled') return null
    if (entry.status === 'sign-in-required' || entry.status === 'insufficient-permission')
      return (
        <Button size="sm" variant="secondary" disabled={!canAdminister} onClick={() => void signIn(connection)}>
          {t('Sign in')}
        </Button>
      )
    if (!entry.granted?.length)
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={!canAdminister || busy !== null}
          onClick={() => void turnOn(connection)}
        >
          {t('Turn on')}
        </Button>
      )
    return null
  }
  return (
    <div className="flex flex-col">
      <CustomizeHeader
        title={t('MCP servers')}
        description={t('Tools from other services, for every agent. Each tool asks before it runs unless you let it.')}
        query={query}
        onQuery={setQuery}
        placeholder={t('Search MCP servers')}
        actions={
          <Button size="sm" variant="secondary" disabled={!canAdminister} onClick={() => setEditing('new')}>
            <Plus size={14} />
            {t('Add server')}
          </Button>
        }
      />
      {error?.id === 'page' && <Quiet alert>{error.text}</Quiet>}
      {!status ? (
        <Quiet>{t('Loading MCP servers…')}</Quiet>
      ) : (
        <>
          <SectionTitle title={t('Your servers')} count={connections.length} />
          {connections.length ? (
            <ExtensionGrid label={t('Your servers')}>
              {connections.map((entry) => (
                <ExtensionItem
                  key={entry.connection.id}
                  name={entry.connection.name}
                  icon={brandOf(entry.connection.name) ? undefined : iconOf(entry.connection)}
                  subtitle={
                    error?.id === entry.connection.id ? <span className="text-bad">{error.text}</span> : describe(entry)
                  }
                  muted={entry.status === 'disabled'}
                  badge={
                    signingIn === entry.connection.id ? (
                      <Badge variant="outline">{t('Signing in…')}</Badge>
                    ) : entry.plugin ? (
                      <Badge variant="outline" title={t('Added by the {0} plugin', { '0': entry.plugin.name })}>
                        <Puzzle size={11} aria-hidden />
                        {displayName(entry.plugin.name)}
                      </Badge>
                    ) : undefined
                  }
                  onOpen={() => setOpenId(entry.connection.id)}
                  action={action(entry)}
                />
              ))}
            </ExtensionGrid>
          ) : (
            <Quiet>{query ? t('No server matches.') : t('No servers yet. Add one below or your own.')}</Quiet>
          )}
          {recommended.length > 0 && (
            <>
              <SectionTitle
                title={t('Recommended')}
                help={t('Hosted by each service; you sign in with your own account.')}
              />
              <ExtensionGrid label={t('Recommended')}>
                {recommended.map((server) => (
                  <ExtensionItem
                    key={server.url}
                    name={server.name}
                    title={server.title}
                    subtitle={server.description}
                    badge={server.plugin ? <Badge variant="outline">{t('Plugin')}</Badge> : undefined}
                    action={
                      server.plugin ? (
                        // Its plugin adds the service's skills to the same server; the server alone stays a choice.
                        <Menu
                          standard
                          label={t('Add {name}', { name: server.name })}
                          icon={<Plus size={16} />}
                          align="end"
                          disabled={!canAdminister || busy !== null}
                          items={[
                            {
                              key: 'plugin',
                              label: t('Add with its skills (plugin)'),
                              onSelect: () => reviewPluginInstall(CLAUDE_PLUGIN_INDEX, server.plugin!),
                            },
                            {
                              key: 'server',
                              label: t('Add only the MCP server'),
                              onSelect: () => void addRecommended(server),
                            },
                          ]}
                        />
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('Add {name}', { name: server.name })}
                          title={server.signIn ? t('Add, then sign in with your account') : t('Add')}
                          disabled={!canAdminister || busy !== null}
                          onClick={() => void addRecommended(server)}
                        >
                          <Plus size={16} />
                        </Button>
                      )
                    }
                  />
                ))}
              </ExtensionGrid>
            </>
          )}
        </>
      )}
      <Advanced title={t('Advanced: accounts per identity, sign-in by address, and every server setting')}>
        <McpSettings />
      </Advanced>
      {open && (
        <ServerDetail
          entry={open}
          busy={busy}
          error={error?.id === open.connection.id ? error.text : null}
          canAdminister={canAdminister}
          logins={loginsFor(open.connection)}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open.connection)}
          onSignIn={() => void signIn(open.connection)}
          onApply={(choices) => void turnOn(open.connection, choices)}
          onEnabled={(enabled) => {
            const { id: _id, hostId: _host, revision: _revision, ...definition } = open.connection
            void act(open.connection.id, () => invoke('mcp.save', { ...definition, enabled }, open.connection.id))
          }}
          onRemove={() =>
            void act(open.connection.id, async () => {
              await invoke('mcp.remove', open.connection.id)
              setOpenId(null)
            })
          }
        />
      )}
      {editing && (
        <ConnectionEditor
          initial={editing === 'new' ? undefined : editing}
          projects={projects}
          defaultProject={
            projects.some((project) => project.id === ws.composing) ? (ws.composing ?? undefined) : undefined
          }
          hostName={t('this host')}
          busy={busy === 'new' || (editing !== 'new' && busy === editing.id)}
          error={
            error && (error.id === 'new' || (editing !== 'new' && error.id === editing.id)) ? error.text : undefined
          }
          onSave={(definition) =>
            editing === 'new'
              ? void add(definition)
              : void act(editing.id, async () => {
                  await invoke('mcp.save', definition, editing.id)
                  setEditing(null)
                })
          }
          onCancel={() => setEditing(null)}
          onSetCredential={(name, value) =>
            editing !== 'new' && void act(editing.id, () => invoke('mcp.setCredential', editing.id, name, value))
          }
          onRemoveCredential={(name) =>
            editing !== 'new' && void act(editing.id, () => invoke('mcp.removeCredential', editing.id, name))
          }
        />
      )}
    </div>
  )
}

/**
 * One server: whether it is on and for whom, and its tools, each asking before it runs, running without asking, or
 * left off. Check connection reads the tools again from the server.
 */
function ServerDetail({
  entry,
  busy,
  error,
  canAdminister,
  logins,
  onClose,
  onEdit,
  onSignIn,
  onApply,
  onEnabled,
  onRemove,
}: {
  entry: Entry
  busy: string | null
  error: string | null
  canAdminister: boolean
  logins: { provider: AgentProvider; accountId: string }[]
  onClose: () => void
  onEdit: () => void
  onSignIn: () => void
  onApply: (choices: Record<string, SharedMcpToolChoice>) => void
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const { connection } = entry
  const [tools, setTools] = useState<SharedMcpInspection['tools'] | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, SharedMcpToolChoice>>({})
  const [confirmRemove, setConfirmRemove] = useState(false)
  const granted = entry.granted?.[0]
  const check = useCallback(async () => {
    const first = logins[0]
    if (!first) {
      setCheckError(t('No agent this server is offered to is signed in here.'))
      return
    }
    setChecking(true)
    setCheckError(null)
    try {
      const inspection = await invoke('mcp.check', connection.id, {
        ...first,
        projectId: connection.scope.hostWide ? null : (connection.scope.projectIds[0] ?? null),
      })
      setTools(inspection.tools)
    } catch (reason) {
      setCheckError(errorText(reason))
    } finally {
      setChecking(false)
    }
  }, [invoke, connection, logins])
  useEffect(() => {
    if (connection.enabled && entry.status !== 'sign-in-required') void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checks once when the server's details open
  }, [connection.id])
  const current = (name: string, tool: SharedMcpInspection['tools'][number]): SharedMcpToolChoice =>
    choices[name] ??
    (granted
      ? (() => {
          const kept = granted.tools.find((entry) => entry.name === name)
          return kept ? (kept.approval === 'connection' ? 'allow' : 'ask') : 'off'
        })()
      : defaultToolChoice(tool))
  const agents = [...new Set((entry.granted ?? []).map((login) => login.provider))]
  if (confirmRemove)
    return (
      <Dialog
        title={t('Remove {name}?', { name: connection.name })}
        confirmLabel={t('Remove')}
        danger
        busy={busy === connection.id}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={onRemove}
      >
        <p className="m-0 text-control">
          {t('Agents lose its tools, and its saved sign-in is deleted from this host.')}
        </p>
      </Dialog>
    )
  return (
    <Dialog
      title={displayName(connection.name)}
      confirmLabel={granted ? t('Save') : t('Turn on')}
      confirmDisabled={!canAdminister || !connection.enabled || !tools?.length}
      busy={busy === connection.id}
      error={error}
      onConfirm={() => onApply(Object.fromEntries((tools ?? []).map((tool) => [tool.name, current(tool.name, tool)])))}
      onCancel={onClose}
      footerLeading={
        entry.plugin ? (
          // What it runs comes from the plugin, so removing or changing it happens there.
          <Button size="sm" variant="ghost" onClick={() => openCustomize('plugins', entry.plugin!.id)}>
            <Puzzle size={13} />
            {t('Open plugin')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="hover:text-bad"
              disabled={!canAdminister}
              onClick={() => setConfirmRemove(true)}
            >
              {t('Remove')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!canAdminister} onClick={onEdit}>
              {t('Edit')}
            </Button>
          </>
        )
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {(() => {
          const full =
            connection.transport.type === 'http'
              ? connection.transport.url
              : [connection.transport.command, ...connection.transport.args].join(' ')
          // A local command reads by its name; the full path is on hover.
          const shown =
            connection.transport.type === 'http'
              ? full
              : [connection.transport.command.split(/[\\/]/).pop(), ...connection.transport.args].join(' ')
          return (
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
              <span className="truncate font-mono" title={full}>
                {shown}
              </span>
              {entry.plugin && (
                <span className="flex-none">
                  · {t('Added by the {0} plugin', { '0': displayName(entry.plugin.name) })}
                </span>
              )}
            </p>
          )
        })()}
        <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-control text-foreground">
              {!connection.enabled
                ? t('Off')
                : agents.length
                  ? agents.length === AGENT_PROVIDERS.length
                    ? t('On for every agent')
                    : t('On for {0}', { '0': agents.map(providerName).join(', ') })
                  : t('Not on yet')}
            </span>
            <span className="text-caption text-muted-foreground">
              {t('Offered to {0}', { '0': connection.providers.map(providerName).join(', ') })}
            </span>
          </span>
          <Switch
            aria-label={t('Use {name}', { name: connection.name })}
            checked={connection.enabled}
            disabled={!canAdminister || busy !== null}
            onCheckedChange={onEnabled}
          />
        </div>
        {connection.transport.type === 'http' &&
          (entry.status === 'sign-in-required' || entry.status === 'insufficient-permission') && (
            <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2 text-caption">
              <span className="text-muted-foreground">
                {t('{name} asks you to sign in with your account.', { name: connection.name })}
              </span>
              <Button size="sm" variant="secondary" disabled={!canAdminister} onClick={onSignIn}>
                {t('Sign in')}
              </Button>
            </div>
          )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-control font-medium text-foreground">{t('Tools')}</span>
          <Button size="sm" variant="ghost" disabled={checking || !connection.enabled} onClick={() => void check()}>
            <RefreshCw size={13} className={checking ? 'animate-spin' : undefined} />
            {t('Check connection')}
          </Button>
        </div>
        {checkError ? (
          <p role="alert" className="m-0 text-caption text-bad">
            {checkError}
          </p>
        ) : !tools ? (
          <p className="m-0 text-caption text-muted-foreground">
            {checking ? t('Connecting…') : t('Check the connection to see its tools.')}
          </p>
        ) : (
          <ul className="m-0 flex max-h-72 list-none flex-col overflow-auto p-0" aria-label={t('Tools')}>
            {tools.map((tool) => (
              <li key={tool.name} className="flex items-center gap-3 py-1.5 [&+&]:border-t [&+&]:border-line">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-caption text-foreground">{tool.name}</span>
                  {tool.description && (
                    <span className="truncate text-caption text-muted-foreground" title={tool.description}>
                      {tool.description}
                    </span>
                  )}
                </span>
                <ToggleGroup
                  size="sm"
                  variant="outline"
                  spacing={0}
                  aria-label={t('{0}: when it runs', { '0': tool.name })}
                  value={[current(tool.name, tool)]}
                  onValueChange={(values) =>
                    values[0] && setChoices({ ...choices, [tool.name]: values[0] as SharedMcpToolChoice })
                  }
                >
                  <ToggleGroupItem value="ask" className="h-7 px-2 text-caption" title={t('Asks you before each call')}>
                    {t('Ask')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="allow" className="h-7 px-2 text-caption" title={t('Runs without asking')}>
                    {t('Allow')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="off" className="h-7 px-2 text-caption" title={t('Agents do not get it')}>
                    {t('Off')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
