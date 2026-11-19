import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, RefreshCw, Server, Share2 } from 'lucide-react'
import {
  CLAUDE_PLUGIN_INDEX,
  listingMatches,
  type InstalledPlugin,
  type PluginListing,
  type PluginReview,
  type PluginScope,
} from '@ramu/shared/plugins'
import type { PortablePlugin, WaitingTool } from '@ramu/shared/toolSync'
import type { AgentProvider, Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Dialog, Menu } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { Credential } from '../settings/Plugins'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { CustomizeHeader, displayName, ExtensionGrid, ExtensionItem, Quiet, SectionTitle } from './parts'
import { PluginHeading, PluginParts, PluginSource } from './PluginParts'
import { openCustomize } from './openCustomize'
import { AvailableOn, mcpLogins, RemoveElsewhere, useRemoveElsewhere, useToolSync, WaitingTools } from './toolSync'
import { useAppSettings } from '../settings/AppSettings'
import { SafetyCheck } from './SafetyCheck'
import { EVERY_USE, UseFor, type UseChoice } from './UseFor'

/** A plugin's scope as the place `UseFor` shows: '' for every project, `identity:<id>`, or a project id. */
const placeOf = (scope: PluginScope) =>
  scope.kind === 'all' ? '' : scope.kind === 'identity' ? `identity:${scope.identityId}` : scope.projectId
const scopeOf = (place: string): PluginScope =>
  place.startsWith('identity:')
    ? { kind: 'identity', identityId: place.slice(9) }
    : place
      ? { kind: 'project', projectId: place }
      : { kind: 'all' }

const matches = (plugin: InstalledPlugin, query: string) =>
  !query.trim() ||
  query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => `${plugin.name} ${plugin.contents.description}`.toLowerCase().includes(word))

/** What the other plugin of a pair adds, by which side it is on. */
const companionText = (companion: { index: string }) =>
  companion.index === CLAUDE_PLUGIN_INDEX
    ? t('The service’s own plugin: its skills teach agents the service in full, often with its MCP server.')
    : t('Ramu’s plugin for it: runs its CLI with your saved sign-in, or reads its data into dashboards.')

/** Cards Claude's directory shows before Show all. */
const CLAUDE_PAGE = 24

/** An index by the name people know it by. */
const indexLabel = (entry: { index: string; indexName: string }) =>
  entry.index === CLAUDE_PLUGIN_INDEX
    ? t('Claude plugins')
    : entry.indexName === 'ramu-plugins'
      ? 'Ramu'
      : entry.indexName

/** A directory category, such as "development", as a label; the directory names them in English. */
const categoryLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** Plugins: what is installed and what needs finishing, then what to add, Ramu's own first. */
export function PluginsSection({
  open: requested,
  install,
}: {
  open?: { id: string } | null
  /** A listed plugin whose install review opens on arrival, asked for from elsewhere in Customize. */
  install?: { index: string; name: string } | null
}) {
  useLanguage()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null)
  const [listings, setListings] = useState<PluginListing[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [review, setReview] = useState<PluginReview | null>(null)
  // The listing a review came from, so the same plugin in another index can be reviewed instead.
  const [reviewing, setReviewing] = useState<PluginListing | null>(null)
  // Plugins installed earlier in a pair whose next step (a key, choosing MCP tools) waits until the companion's review closes.
  const [installedPair, setInstalledPair] = useState<InstalledPlugin[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState<'source' | 'index' | null>(null)
  const { status: sync } = useToolSync()
  const { preferences } = useAppSettings()
  // A plugin another host sent: once installed here, its servers' tools are turned on as they are there.
  const [fromHost, setFromHost] = useState<PortablePlugin | null>(null)
  // The identity a received plugin belongs to on its other host, when this host has that identity too.
  const [identity, setIdentity] = useState<{ id: string; name: string } | null>(null)
  // The project here on the same remote as a received project plugin's project there.
  const [projectScope, setProjectScope] = useState<string | null>(null)
  useEffect(() => {
    if (requested) setOpenId(requested.id)
  }, [requested])
  const load = useCallback(() => {
    void invoke('plugins.list').then(setInstalled, (reason) => setError(errorText(reason)))
    void invoke('plugins.browse').then(setListings, (reason) => setError(errorText(reason)))
  }, [invoke])
  useEffect(() => {
    load()
    void invoke('projects.list').then(setProjects, () => {})
    return on('plugins:changed', load)
  }, [load, invoke, on])
  /** Runs one action; false when it failed, so a dialog that started it stays open with what was typed. */
  const act = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await work()
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
    } finally {
      setBusy(null)
    }
  }
  const stage = (key: string, input: Parameters<typeof invoke<'plugins.stage'>>[1]) =>
    act(key, async () => setReview(await invoke('plugins.stage', input)))
  /**
   * After installing: a key one of them asks for first, else choosing what the first MCP server's tools may do, since a
   * server is useful only once it is on and some of its tools should ask before they run.
   */
  const nextStep = (plugins: InstalledPlugin[]) => {
    setInstalledPair([])
    const needsKey = plugins.find((plugin) => plugin.credentials.some((slot) => slot.state !== 'saved'))
    const server = plugins.flatMap((plugin) => plugin.mcpConnections)[0]
    if (needsKey) setOpenId(needsKey.id)
    else if (server) openCustomize('mcp', server.id)
  }
  /** The plugin a review's plugin pairs with, unless it is installed already. */
  const companionFor = (staged: PluginReview) => {
    const listing = listings?.find((entry) => entry.name === staged.contents.name)
    const companion = listing?.companion
    return companion && !installed?.some((plugin) => plugin.name === companion.name) ? companion : null
  }
  /** The same review an install from here opens: through its index when this host has it, else from its commit. */
  const reviewWaiting = (entry: WaitingTool) => {
    const tool = entry.tool as PortablePlugin
    const here = installed?.find((plugin) => plugin.name === tool.name)
    const listing = listings?.find((item) => item.name === tool.name && item.index === tool.index)
    setFromHost(tool)
    setProjectScope(entry.projectId ?? null)
    setReviewing(listing ?? null)
    void act(entry.key, async () => {
      const owner = tool.identityId
        ? (await invoke('identities.get')).settings.identities.find((item) => item.id === tool.identityId)
        : undefined
      setIdentity(owner ? { id: owner.id, name: owner.name } : null)
      setReview(
        here
          ? await invoke('plugins.updateReview', here.id, tool.commit ?? undefined)
          : await invoke(
              'plugins.stage',
              listing
                ? { source: listing.name, index: listing.index, ...(tool.commit ? { commit: tool.commit } : {}) }
                : {
                    source: tool.location,
                    ...(tool.commit ? { ref: tool.commit } : {}),
                    ...(tool.path ? { path: tool.path } : {}),
                  },
            ),
      )
    })
  }
  /** Turns on a received plugin's servers with the tools its other host has on, the rest off. */
  const turnOnAsThere = async (plugin: InstalledPlugin, tool: PortablePlugin) => {
    const servers = plugin.mcpConnections.filter((server) => tool.servers[server.name])
    if (!servers.length) return
    const status = await invoke('mcp.status')
    for (const server of servers) {
      const connection = status.connections.find((entry) => entry.connection.id === server.id)?.connection
      const logins = connection ? mcpLogins(preferences, connection) : []
      // A server that needs its key or a sign-in first is turned on from its card once that is done.
      if (logins.length) await invoke('mcp.turnOn', server.id, logins, tool.servers[server.name], 'off').catch(() => {})
    }
  }
  const openListing = (listing: PluginListing) => {
    setReviewing(listing)
    void stage(`listing:${listing.name}`, { source: listing.name, index: listing.index })
  }
  useEffect(() => {
    if (install) void stage(`listing:${install.name}`, { source: install.name, index: install.index })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opens once for each request
  }, [install])
  const shown = (installed ?? []).filter((plugin) => matches(plugin, query))
  const needsSetup = shown.filter((plugin) => plugin.credentials.some((slot) => slot.state !== 'saved'))
  const ready = shown.filter((plugin) => !needsSetup.includes(plugin))
  const available = useMemo(
    () => (listings ?? []).filter((listing) => !listing.installed && listingMatches(listing, query)),
    [listings, query],
  )
  const recommended = available.filter((listing) => listing.byRamu)
  const claude = available.filter((listing) => !listing.byRamu && listing.index === CLAUDE_PLUGIN_INDEX)
  const others = available.filter((listing) => !listing.byRamu && listing.index !== CLAUDE_PLUGIN_INDEX)
  // Claude's directory is long: a category narrows it, and a page of cards shows until the person asks for the rest.
  const [category, setCategory] = useState('')
  const [allClaude, setAllClaude] = useState(false)
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const listing of claude)
      if (listing.category) counts.set(listing.category, (counts.get(listing.category) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [claude])
  const inCategory = claude.filter((listing) => !category || listing.category === category)
  const claudeShown = allClaude || query ? inCategory : inCategory.slice(0, CLAUDE_PAGE)
  const open = installed?.find((plugin) => plugin.id === openId) ?? null
  const installedItem = (plugin: InstalledPlugin, setup: boolean) => (
    <ExtensionItem
      key={plugin.id}
      name={plugin.name}
      picture={plugin.picture}
      subtitle={plugin.contents.description || plugin.source.location}
      muted={!plugin.enabled}
      badge={
        <>
          {plugin.source.kind === 'development' && <Badge variant="outline">{t('Development')}</Badge>}
          {plugin.update && <Badge variant="secondary">{t('Update')}</Badge>}
          {!plugin.enabled && <Badge variant="outline">{t('Off')}</Badge>}
        </>
      }
      onOpen={() => setOpenId(plugin.id)}
      action={
        setup ? (
          <Button size="sm" variant="secondary" onClick={() => setOpenId(plugin.id)}>
            {t('Finish setup')}
          </Button>
        ) : undefined
      }
    />
  )
  const listingItem = (listing: PluginListing) => (
    <ExtensionItem
      key={`${listing.index}:${listing.name}`}
      name={listing.name}
      picture={listing.picture}
      subtitle={listing.description}
      badge={
        listing.alternatives.length ? (
          <Badge variant="outline" title={listing.alternatives.map((entry) => entry.indexName).join(', ')}>
            {t('Also in {0}', { '0': indexLabel(listing.alternatives[0]!) })}
          </Badge>
        ) : undefined
      }
      onOpen={() => openListing(listing)}
      action={
        <Button
          size="sm"
          variant="secondary"
          aria-label={t('Install {name}', { name: listing.name })}
          disabled={busy !== null}
          onClick={() => openListing(listing)}
        >
          {busy === `listing:${listing.name}` && <RefreshCw size={13} className="animate-spin" aria-hidden />}
          {t('Install')}
        </Button>
      }
    />
  )
  return (
    <div className="flex flex-col">
      <CustomizeHeader
        title={t('Plugins')}
        description={t(
          'Add a service to every agent in one install: its skills, MCP servers, sign-in and safe commands.',
        )}
        query={query}
        onQuery={setQuery}
        placeholder={t('Search plugins')}
        actions={
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('Check for updates')}
              title={t('Check for updates')}
              disabled={busy !== null}
              onClick={() => void act('updates', async () => setInstalled(await invoke('plugins.checkUpdates')))}
            >
              <RefreshCw size={15} className={busy === 'updates' ? 'animate-spin' : undefined} />
            </Button>
            <Menu
              standard
              label={t('Add')}
              icon={
                <>
                  {t('Add')}
                  <ChevronDown size={13} />
                </>
              }
              className="h-8 gap-1 rounded-(--radius-s) bg-fill px-3 text-control text-foreground hover:bg-fill-hover"
              align="end"
              items={[
                { key: 'source', label: t('From a GitHub address or folder…'), onSelect: () => setAdding('source') },
                { key: 'index', label: t('Add a plugin index…'), onSelect: () => setAdding('index') },
              ]}
            />
          </>
        }
      />
      {error && <Quiet alert>{error}</Quiet>}
      {!installed || !listings ? (
        <Quiet>{t('Loading plugins…')}</Quiet>
      ) : (
        <>
          <WaitingTools
            kind="plugin"
            status={sync}
            busy={busy}
            onReview={reviewWaiting}
            onRemove={(entry) => {
              const here = installed.find((plugin) => plugin.name === entry.tool.name)
              if (here) void act(entry.key, () => invoke('plugins.remove', here.id).then(load))
            }}
          />
          {needsSetup.length > 0 && (
            <>
              <SectionTitle title={t('Needs setup')} help={t('Add the key each one asks for and it is ready.')} />
              <ExtensionGrid label={t('Needs setup')}>
                {needsSetup.map((plugin) => installedItem(plugin, true))}
              </ExtensionGrid>
            </>
          )}
          <SectionTitle title={t('Installed')} count={ready.length} />
          {ready.length ? (
            <ExtensionGrid label={t('Installed')}>{ready.map((plugin) => installedItem(plugin, false))}</ExtensionGrid>
          ) : (
            <Quiet>{query ? t('No installed plugin matches.') : t('Nothing installed yet. Pick one below.')}</Quiet>
          )}
          {recommended.length > 0 && (
            <>
              <SectionTitle title={t('Recommended')} help={t('Made and signed by Ramu.')} />
              <ExtensionGrid label={t('Recommended')}>{recommended.map(listingItem)}</ExtensionGrid>
            </>
          )}
          {claude.length > 0 && (
            <>
              <SectionTitle
                title={t('Claude plugins')}
                count={inCategory.length}
                help={t('Claude’s plugin directory. Ramu uses their skills, MCP servers, agents and slash commands.')}
              />
              {categories.length > 1 && (
                <div role="group" aria-label={t('Category')} className="mb-2 flex flex-wrap gap-1">
                  {['', ...categories].map((name) => (
                    <Button
                      key={name || 'all'}
                      size="sm"
                      variant="ghost"
                      aria-pressed={category === name}
                      className="h-7 rounded-full border border-line px-2.5 text-caption text-muted-foreground aria-pressed:bg-fill aria-pressed:text-foreground"
                      onClick={() => setCategory(name)}
                    >
                      {name ? categoryLabel(name) : t('All')}
                    </Button>
                  ))}
                </div>
              )}
              <ExtensionGrid label={t('Claude plugins')}>{claudeShown.map(listingItem)}</ExtensionGrid>
              {claudeShown.length < inCategory.length && (
                <Button size="sm" variant="ghost" className="mt-2 self-start" onClick={() => setAllClaude(true)}>
                  {t('Show all {0}', { '0': inCategory.length })}
                </Button>
              )}
            </>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle title={t('More plugins')} help={t('From the other indexes you added.')} />
              <ExtensionGrid label={t('More plugins')}>{others.map(listingItem)}</ExtensionGrid>
            </>
          )}
          {query && !shown.length && !available.length && (
            <Quiet>
              {t('No plugin matches "{0}". Try fewer words, or add one from its GitHub address.', { '0': query })}
            </Quiet>
          )}
        </>
      )}
      {review && (
        <InstallReview
          review={review}
          alternatives={
            reviewing && reviewing.name === review.contents.name
              ? [
                  { index: reviewing.index, indexName: reviewing.indexName, source: reviewing.source },
                  ...reviewing.alternatives,
                ].filter((entry) => entry.index !== review.source.index)
              : []
          }
          onAlternative={(entry) => {
            void invoke('plugins.cancel', review.stageId).catch(() => {})
            setReview(null)
            void stage(`listing:${review.contents.name}`, { source: review.contents.name, index: entry.index })
          }}
          projects={projects}
          identity={fromHost?.name === review.contents.name ? identity : null}
          projectId={fromHost?.name === review.contents.name ? projectScope : null}
          busy={busy === 'confirm'}
          companion={companionFor(review)}
          onCancel={() => {
            void invoke('plugins.cancel', review.stageId).catch(() => {})
            setReview(null)
            setFromHost(null)
            setIdentity(null)
            nextStep(installedPair)
          }}
          onConfirm={(options, withCompanion) =>
            void act('confirm', async () => {
              const plugin = await invoke('plugins.confirm', review.stageId, options)
              setReview(null)
              if (fromHost?.name === plugin.name) await turnOnAsThere(plugin, fromHost)
              setFromHost(null)
              setIdentity(null)
              load()
              const companion = companionFor(review)
              if (withCompanion && companion) {
                // The pair installs in one go: the companion's own review next, then the first step either needs.
                setInstalledPair([...installedPair, plugin])
                void stage(`listing:${companion.name}`, { source: companion.name, index: companion.index })
              } else nextStep([...installedPair, plugin])
            })
          }
        />
      )}
      {open && (
        <PluginDetail
          plugin={open}
          sync={sync}
          projects={projects}
          busy={busy}
          onChanged={load}
          onClose={() => setOpenId(null)}
          onUpdate={() => void act('update', async () => setReview(await invoke('plugins.updateReview', open.id)))}
          onToggle={(enabled) => void act('toggle', () => invoke('plugins.setEnabled', open.id, enabled).then(load))}
          onUse={(use) =>
            void act('use', () =>
              invoke('plugins.setUse', open.id, { scope: scopeOf(use.place), providers: use.providers }).then(load),
            )
          }
          onRemove={() =>
            void act('remove', async () => {
              await invoke('plugins.remove', open.id)
              setOpenId(null)
              load()
            })
          }
          onShare={() => act('share', () => invoke('plugins.share', open.id))}
          onCompanion={(companion) => {
            setOpenId(null)
            void stage(`listing:${companion.name}`, { source: companion.name, index: companion.index })
          }}
        />
      )}
      {adding && (
        <AddSource
          kind={adding}
          busy={busy !== null}
          error={error}
          onCancel={() => {
            setAdding(null)
            setError(null)
          }}
          onSubmit={(value) =>
            adding === 'source'
              ? void stage('source', { source: value }).then((done) => done && setAdding(null))
              : void act('index', async () => {
                  await invoke('plugins.addIndex', value)
                  setAdding(null)
                  load()
                })
          }
        />
      )}
    </div>
  )
}

/** Everything a plugin would add, before anything is saved, laid out the same as an installed plugin's details. */
function InstallReview({
  review,
  alternatives,
  onAlternative,
  companion,
  projects,
  identity,
  projectId,
  busy,
  onConfirm,
  onCancel,
}: {
  review: PluginReview
  /** The same plugin listed in other indexes. */
  alternatives: { index: string; indexName: string; source: string }[]
  onAlternative: (entry: { index: string; indexName: string; source: string }) => void
  /** The plugin this one pairs with, offered for review straight after. */
  companion: { index: string; name: string } | null
  projects: Project[]
  /** The identity a plugin from another host belongs to there, chosen first when this host has it. */
  identity?: { id: string; name: string } | null
  /** The project a plugin from another host is for there, as the project on the same remote here. */
  projectId?: string | null
  busy: boolean
  onConfirm: (options: { scope: PluginScope; providers: AgentProvider[] }, withCompanion: boolean) => void
  onCancel: () => void
}) {
  useLanguage()
  const { contents, source } = review
  const [use, setUse] = useState<UseChoice>({
    ...EVERY_USE,
    place: identity ? `identity:${identity.id}` : (projectId ?? ''),
  })
  const [withCompanion, setWithCompanion] = useState(true)
  const scriptFiles = contents.skills.flatMap((skill) => skill.scripts.map((path) => `${skill.name}/${path}`))
  return (
    <Dialog
      title={
        review.replaces
          ? t('Update {name}', { name: displayName(contents.name) })
          : t('Install {name}', { name: displayName(contents.name) })
      }
      confirmLabel={review.replaces ? t('Update') : t('Install')}
      busy={busy}
      confirmDisabled={!!review.blocked}
      error={review.blocked}
      onCancel={onCancel}
      onConfirm={() => onConfirm({ scope: scopeOf(use.place), providers: use.providers }, withCompanion)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <PluginHeading contents={contents} source={source} byRamu={review.byRamu} />
        {review.changes.length > 0 && (
          <div className="rounded-(--radius-s) bg-fill p-2.5 text-caption">
            <span className="mb-1 block font-medium text-foreground">
              {review.needsApproval ? t('What changes (it asks for approval again)') : t('What changes')}
            </span>
            <ul className="m-0 pl-4 text-muted-foreground">
              {review.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        )}
        {!review.replaces && (
          <UseFor
            value={use}
            onChange={setUse}
            projects={projects}
            disabled={busy}
            places={
              identity ? [{ value: `identity:${identity.id}`, label: t('{0} projects', { 0: identity.name }) }] : []
            }
          />
        )}
        <SafetyCheck target={{ kind: 'plugin', stageId: review.stageId }} disabled={busy} />
        <PluginParts contents={contents} />
        {companion && (
          <label className="flex items-start gap-2 rounded-(--radius-s) bg-fill px-3 py-2 text-caption">
            <Checkbox checked={withCompanion} onCheckedChange={(value) => setWithCompanion(value === true)} />
            <span className="flex flex-col gap-0.5">
              <span className="text-control text-foreground">
                {t('Also review {0} next', { '0': displayName(companion.name) })}
              </span>
              <span className="text-muted-foreground">{companionText(companion)}</span>
            </span>
          </label>
        )}
        {alternatives.map((entry) => (
          <div
            key={entry.index}
            className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2 text-caption"
          >
            <span className="min-w-0 text-muted-foreground">
              {t('{0} also lists a plugin with this name.', { '0': indexLabel(entry) })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="flex-none"
              disabled={busy}
              onClick={() => onAlternative(entry)}
            >
              {t('Review that one')}
            </Button>
          </div>
        ))}
        {contents.problems.map((problem) => (
          <p key={`${problem.file}:${problem.message}`} role="alert" className="m-0 text-caption text-bad">
            {problem.file}: {problem.message}
          </p>
        ))}
        {scriptFiles.length > 0 && (
          <p className="m-0 text-caption text-muted-foreground">
            {t('Its skills come with the scripts they call. Ramu never runs them itself.')}
            <span className="block break-all">{scriptFiles.join(', ')}</span>
          </p>
        )}
        <PluginSource source={source} />
      </div>
    </Dialog>
  )
}

/** An installed plugin: its sign-in first when it still needs one, then what it adds and how to change it. */
function PluginDetail({
  plugin,
  sync,
  projects,
  busy,
  onChanged,
  onClose,
  onUpdate,
  onToggle,
  onUse,
  onRemove,
  onShare,
  onCompanion,
}: {
  plugin: InstalledPlugin
  sync: ReturnType<typeof useToolSync>['status']
  projects: Project[]
  busy: string | null
  onChanged: () => void
  onClose: () => void
  onUpdate: () => void
  onToggle: (enabled: boolean) => void
  onUse: (use: UseChoice) => void
  onRemove: () => void
  onShare: () => Promise<unknown>
  onCompanion: (companion: { index: string; name: string }) => void
}) {
  useLanguage()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const elsewhere = useRemoveElsewhere(`plugin:${plugin.name}`, sync)
  if (confirmRemove)
    return (
      <Dialog
        title={t('Remove {name}?', { name: displayName(plugin.name) })}
        confirmLabel={t('Remove')}
        danger
        busy={busy === 'remove'}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void elsewhere.before().then(onRemove)}
      >
        <p className="m-0 text-control">
          {t('Its skills, MCP servers, rule and saved key go with it. Threads already running keep what they had.')}
        </p>
        <RemoveElsewhere control={elsewhere} />
      </Dialog>
    )
  return (
    <Dialog
      title={displayName(plugin.name)}
      confirmLabel={t('Done')}
      cancellable={false}
      onConfirm={onClose}
      onCancel={onClose}
      footerLeading={
        <Button size="sm" variant="ghost" className="hover:text-bad" onClick={() => setConfirmRemove(true)}>
          {t('Remove')}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <PluginHeading contents={plugin.contents} source={plugin.source} byRamu={plugin.byRamu} />
        <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2">
          <span className="flex flex-col">
            <span className="text-control text-foreground">{plugin.enabled ? t('On') : t('Off')}</span>
            <span className="text-caption text-muted-foreground">
              {plugin.enabled ? t('Agents use it in new turns.') : t('Agents do not get it until you turn it on.')}
            </span>
          </span>
          <Switch
            aria-label={t('Use {name}', { name: plugin.name })}
            checked={plugin.enabled}
            disabled={busy !== null}
            onCheckedChange={onToggle}
          />
        </div>
        {plugin.credentials.map((slot) => (
          <Credential key={slot.id} plugin={plugin} slot={slot} viewOnly={false} onChanged={onChanged} />
        ))}
        <UseFor
          value={{ providers: plugin.providers, place: placeOf(plugin.scope) }}
          onChange={onUse}
          projects={projects}
          disabled={busy !== null}
          places={
            plugin.scope.kind === 'identity'
              ? [{ value: placeOf(plugin.scope), label: t('One identity’s projects') }]
              : []
          }
        />
        <SafetyCheck target={{ kind: 'plugin', pluginId: plugin.id }} disabled={busy !== null} />
        {plugin.update && (
          <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2 text-caption">
            <span className="min-w-0 text-muted-foreground">{plugin.update.changes.join('; ')}</span>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onUpdate}>
              {t('Review update')}
            </Button>
          </div>
        )}
        {plugin.companion && (
          <div className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2 text-caption">
            <span className="flex min-w-0 flex-col">
              <span className="text-control text-foreground">
                {t('Pairs with {0}', { '0': displayName(plugin.companion.name) })}
              </span>
              <span className="text-muted-foreground">{companionText(plugin.companion)}</span>
            </span>
            {plugin.companion.installed ? (
              <Check size={15} className="flex-none text-muted-foreground" aria-label={t('Installed')} />
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="flex-none"
                onClick={() => onCompanion(plugin.companion!)}
              >
                {t('Review')}
              </Button>
            )}
          </div>
        )}
        {plugin.mcpConnections.length > 0 && (
          // Each server's tools are chosen where every MCP server's are; this is the way there.
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('Its MCP servers')}>
            {plugin.mcpConnections.map((server) => (
              <li
                key={server.id}
                className="flex items-center justify-between gap-3 rounded-(--radius-s) bg-fill px-3 py-2 text-caption"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Server size={14} className="flex-none text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-control text-foreground">{server.name}</span>
                    <span className="text-muted-foreground">{t('Choose which tools ask before they run')}</span>
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => openCustomize('mcp', server.id)}>
                  {t('Choose tools')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AvailableOn toolKey={`plugin:${plugin.name}`} status={sync} />
        <PluginParts contents={plugin.contents} />
        <div className="flex items-center justify-between gap-2">
          <PluginSource source={plugin.source} />
          {plugin.source.kind === 'development' && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void onShare()}>
              <Share2 size={13} />
              {t('Share')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function AddSource({
  kind,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  kind: 'source' | 'index'
  busy: boolean
  /** Why the last try failed, shown in the dialog so the address can be corrected without typing it again. */
  error: string | null
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  useLanguage()
  const [value, setValue] = useState('')
  return (
    <Dialog
      title={kind === 'source' ? t('Install a plugin from its address') : t('Add a plugin index')}
      confirmLabel={kind === 'source' ? t('Review') : t('Add')}
      busy={busy}
      confirmDisabled={!value.trim()}
      onCancel={onCancel}
      onConfirm={() => onSubmit(value.trim())}
    >
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          aria-label={kind === 'source' ? t('GitHub address or folder') : t('Index address')}
          placeholder={kind === 'source' ? 'github.com/acme/render-plugin' : 'github.com/acme/plugins'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="m-0 text-caption text-muted-foreground">
          {kind === 'source'
            ? t('Nothing is saved until you review what it adds.')
            : t('Its plugins appear under More plugins.')}
        </p>
        {error && <Quiet alert>{error}</Quiet>}
      </div>
    </Dialog>
  )
}
