import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Share2, ShieldCheck, Trash2 } from 'lucide-react'
import { SearchInput } from '../SearchInput'
import { Switch } from '@/components/ui/switch'
import {
  UNUSED_PART_NAMES,
  type InstalledPlugin,
  type PluginIndexInfo,
  type PluginListing,
  type PluginReview,
  type PluginScope,
  listingMatches,
} from '@ramu/shared/plugins'
import { ABILITY_LABELS } from '@ramu/shared/providers/abilities'
import type { AgentProvider, Project } from '@ramu/shared/types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { InlineAction } from '@/components/inline-action'
import { ContentSkeleton } from '@/components/content-skeleton'
import { ExpandRow } from '@/components/expand-row'
import { Badge } from '@/components/ui/badge'
import { Dialog, Dropdown } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { invoke as onThisComputer } from '../ipc'
import { errorText } from '../lib/errors'
import { takePendingPluginSource } from './pluginLinks'
import { SETTINGS_CARD, SettingsCard, SettingsCardList, SettingsEmpty, SettingsSectionHead } from './cards'
import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { accountKey } from '@ramu/shared/identities'
import { AccountIdentityPicker, IdentityDropdown, IdentityName, useAccountIdentities } from './AccountIdentity'

const open = (url: string) => void onThisComputer('app.openExternal', url)

function Problem({ children }: { children: string }) {
  return (
    <p role="alert" className="m-0 text-caption text-bad">
      {children}
    </p>
  )
}

/** Everything a plugin would add, before anything is saved: the same list the agent's install card names. */
function Review({
  review,
  projects,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  review: PluginReview
  projects: Project[]
  busy: boolean
  error: string | null
  onConfirm: (options: { scope: PluginScope; providers: AgentProvider[] }) => void
  onCancel: () => void
}) {
  const { contents, source } = review
  const [scope, setScope] = useState('')
  const scriptFiles = contents.skills.flatMap((skill) => skill.scripts.map((path) => `${skill.name}/${path}`))
  return (
    <Dialog
      title={
        review.replaces
          ? t('Review the update to {name}', { name: contents.name })
          : t('Install {name}?', { name: contents.name })
      }
      confirmLabel={review.replaces ? t('Update') : t('Install')}
      busy={busy}
      confirmDisabled={!!review.blocked}
      error={error ?? review.blocked}
      onCancel={onCancel}
      onConfirm={() =>
        onConfirm({
          scope: scope ? { kind: 'project', projectId: scope } : { kind: 'all' },
          providers: [...AGENT_PROVIDERS],
        })
      }
    >
      <div className="flex flex-col gap-2 text-control">
        {contents.description && <p className="m-0">{contents.description}</p>}
        <p className="m-0 break-all text-caption text-muted-foreground">
          {[
            contents.author ? t('By {author}', { author: contents.author }) : '',
            contents.version ? `v${contents.version}` : '',
            contents.license ?? '',
            `${source.location}${source.path ? ` · ${source.path}` : ''}`,
            source.commit ? source.commit.slice(0, 12) : t('Folder on this computer'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="flex flex-wrap gap-1">
          {review.byRamu && <Badge variant="secondary">{t('By Ramu')}</Badge>}
          <Badge variant="outline">
            {source.signedBy ? t('Signed by {name}', { name: source.signedBy }) : t('Unsigned')}
          </Badge>
          {review.replaces && review.needsApproval && (
            <Badge variant="destructive">{t('Asks for approval again')}</Badge>
          )}
        </div>
        {review.changes.length > 0 && (
          <ul className="m-0 pl-4">
            {review.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
        {contents.skills.length > 0 && (
          <section>
            <strong>{t('Skills')}</strong>
            <ul className="m-0 pl-4">
              {contents.skills.map((skill) => (
                <li key={skill.name}>
                  {skill.name} — {skill.description}
                </li>
              ))}
            </ul>
          </section>
        )}
        {contents.mcpServers.length > 0 && (
          <section>
            <strong>{t('MCP servers')}</strong>
            <ul className="m-0 pl-4">
              {contents.mcpServers.map((server) => (
                <li key={server.name} className="break-all">
                  {server.name}:{' '}
                  <code>{server.type === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
        {contents.agents.length > 0 && (
          <p className="m-0">
            <strong>{t('Custom agents')}:</strong> {contents.agents.map((agent) => agent.name).join(', ')}
          </p>
        )}
        {contents.rule && <p className="m-0">{t('A rule from its AGENTS.md')}</p>}
        {contents.credentials.length > 0 && (
          <p className="m-0">
            <strong>{t('Asks for')}:</strong> {contents.credentials.map((slot) => slot.label).join(', ')}
          </p>
        )}
        {contents.cli && (
          <p className="m-0">
            <strong>{t('CLI')}:</strong> <code>{contents.cli.binaries[0]}</code>.{' '}
            {contents.cli.reads.length
              ? t('Runs without asking: {commands}. Every other command asks you.', {
                  commands: contents.cli.reads.join(', '),
                })
              : t('Every command asks you.')}
          </p>
        )}
        {contents.abilities.length > 0 && (
          <p className="m-0">
            <strong>{t('Abilities')}:</strong>{' '}
            {contents.abilities.map((entry) => t(ABILITY_LABELS[entry.ability])).join(', ')}
          </p>
        )}
        {contents.dataSources.length > 0 && (
          <p className="m-0">
            <strong>{t('Dashboard data')}:</strong> {contents.dataSources.map((entry) => entry.label).join(', ')}
          </p>
        )}
        {contents.unused.length > 0 && (
          <p className="m-0 text-caption text-muted-foreground">
            {t('Not used in Ramu: {parts}', {
              parts: contents.unused.map((part) => t(UNUSED_PART_NAMES[part])).join(', '),
            })}
          </p>
        )}
        {contents.problems.map((problem) => (
          <Problem key={`${problem.file}:${problem.message}`}>{`${problem.file}: ${problem.message}`}</Problem>
        ))}
        {!review.replaces && (
          <Dropdown
            label={t('Applies to')}
            value={scope}
            options={[
              { value: '', label: t('All projects') },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={setScope}
          />
        )}
        {scriptFiles.length > 0 && (
          <p className="m-0 text-caption text-muted-foreground">
            {t('Its skills come with the scripts they call. Ramu never runs them itself.')}
            <span className="block break-all">{scriptFiles.join(', ')}</span>
          </p>
        )}
      </div>
    </Dialog>
  )
}

/** One credential slot on a plugin's card: paste a token, sign in, or see who it belongs to. */
export function Credential({
  plugin,
  slot,
  viewOnly,
  onChanged,
}: {
  plugin: InstalledPlugin
  slot: InstalledPlugin['credentials'][number]
  viewOnly: boolean
  onChanged: () => void
}) {
  const invoke = useSettingsInvoke()
  // With two or more identities, a value can be kept for one of them, splitting the slot.
  const { identities, identity } = useAccountIdentities()
  const declared = plugin.contents.credentials.find((entry) => entry.id === slot.id)
  const [token, setToken] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [sandbox, setSandbox] = useState(false)
  const [forIdentity, setForIdentity] = useState('')
  const [editing, setEditing] = useState(slot.state !== 'saved')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!declared) return null
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await run()
      setToken('')
      setFields({})
      setEditing(false)
      onChanged()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  // Identities that could still keep their own value beside the one for every identity.
  const free = (identities ?? []).filter((entry) => !slot.identities.includes(entry.id))
  const split =
    slot.identities.length > 0 ? (
      <ul className="m-0 flex flex-col gap-0.5 p-0">
        {slot.identities.map((id) => (
          <li key={id} className="flex list-none items-center gap-2 text-caption">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{declared.label}</span>
              {(() => {
                const own = identity(id)
                return own ? <IdentityName identity={own} /> : null
              })()}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={viewOnly || busy}
              onClick={() => void act(() => invoke('plugins.removeCredential', plugin.id, slot.id, id))}
            >
              {t('Remove')}
            </Button>
          </li>
        ))}
      </ul>
    ) : null
  if (!editing && slot.state === 'saved')
    return (
      <>
        {split}
        <div className="flex items-center gap-2 text-caption">
          <span className="min-w-0 flex-1 truncate">
            {declared.label}: {slot.account}
          </span>
          {declared.kind === 'token' && free.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={viewOnly}
              onClick={() => {
                setForIdentity(free[0]!.id)
                setEditing(true)
              }}
            >
              {t('Add account')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={viewOnly}
            onClick={() => {
              setForIdentity('')
              setEditing(true)
            }}
          >
            {t('Replace')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={viewOnly || busy}
            onClick={() => void act(() => invoke('plugins.removeCredential', plugin.id, slot.id))}
          >
            {t('Remove')}
          </Button>
        </div>
      </>
    )
  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-2.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && slot.state === 'saved') {
          event.stopPropagation()
          setEditing(false)
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (declared.kind === 'sign-in')
          void act(async () => {
            const { url } = await invoke('plugins.signIn', plugin.id, slot.id, { clientId: token.trim(), sandbox })
            open(url)
          })
        else
          void act(() =>
            invoke('plugins.setCredential', plugin.id, slot.id, { token, fields }, forIdentity || undefined),
          ).then(() => setForIdentity(''))
      }}
    >
      <p className="m-0 text-caption text-muted-foreground">
        {declared.kind === 'sign-in'
          ? t('Sign in with your own client: paste its client id, then finish in the browser.')
          : t('Paste {label}. It stays in this computer’s credential store.', { label: declared.label })}
        {declared.scope ? ` ${t('Scope: {scope}', { scope: declared.scope })}` : ''}
        {declared.page && (
          <>
            {' '}
            <InlineAction onClick={() => open(declared.page!)}>
              {declared.kind === 'sign-in' ? t('Make a client') : t('Get one')}
            </InlineAction>
          </>
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type={declared.kind === 'sign-in' ? 'text' : 'password'}
          className="w-full"
          aria-label={declared.kind === 'sign-in' ? t('Client id') : declared.label}
          placeholder={declared.kind === 'sign-in' ? t('Client id') : declared.label}
          autoComplete="off"
          value={token}
          disabled={viewOnly || busy}
          onChange={(event) => setToken(event.target.value)}
        />
        {declared.kind === 'token' &&
          declared.fields.map((field) =>
            field.values ? (
              <Dropdown
                key={field.id}
                label={field.label}
                value={fields[field.id] ?? ''}
                options={field.values.map((value) => ({ value, label: value }))}
                onChange={(value) => setFields({ ...fields, [field.id]: value })}
              />
            ) : (
              <Input
                key={field.id}
                className="w-full"
                type={field.kind === 'secret' ? 'password' : 'text'}
                aria-label={field.label}
                placeholder={field.label}
                value={fields[field.id] ?? ''}
                disabled={viewOnly || busy}
                onChange={(event) => setFields({ ...fields, [field.id]: event.target.value })}
              />
            ),
          )}
      </div>
      {error && <Problem>{error}</Problem>}
      <div className="flex flex-wrap items-center gap-2">
        {/* A first value is for every identity; "For" appears when adding one for a single identity beside it. */}
        {declared.kind === 'token' && identities && slot.state === 'saved' && (
          <IdentityDropdown
            identities={identities}
            caption={t('For')}
            label={t('Which identity uses it')}
            value={forIdentity}
            onChange={setForIdentity}
          />
        )}
        {declared.kind === 'sign-in' && (
          <label className="flex items-center gap-2 text-caption">
            <Checkbox checked={sandbox} onCheckedChange={(value) => setSandbox(value === true)} />
            {t('Sandbox')}
          </label>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {slot.state === 'saved' && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
          )}
          <Button size="sm" type="submit" disabled={viewOnly || busy || !token.trim()}>
            {declared.kind === 'sign-in' ? t('Sign in') : busy ? t('Checking…') : t('Save')}
          </Button>
        </span>
      </div>
    </form>
  )
}

/**
 * Settings › Plugins: what is installed and what it still needs, Browse across the indexes, and Install from a listing,
 * a Git address or a folder. Every install shows one review first; credentials are pasted here, on the host.
 */
export function PluginSettings() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  const viewOnly = useViewOnly()
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [indexes, setIndexes] = useState<PluginIndexInfo[]>([])
  const [listings, setListings] = useState<PluginListing[] | null>(null)
  const [listingError, setListingError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [link] = useState(takePendingPluginSource)
  const [more, setMore] = useState(() => !!link && !link.index)
  const [source, setSource] = useState(link && !link.index ? link.source : '')
  const [newIndex, setNewIndex] = useState('')
  const [review, setReview] = useState<PluginReview | null>(null)
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Installed plugins and every listing load when the page opens; typing filters the listings here, without a request.
  const reload = useCallback(() => {
    void invoke('plugins.list').then(
      (next) => {
        setPlugins(next)
        setError(null)
      },
      (cause) => setError(errorText(cause)),
    )
    void invoke('plugins.indexes').then(setIndexes, () => {})
    void invoke('plugins.browse').then(
      (next) => {
        setListings(next)
        setListingError(null)
      },
      (cause) => setListingError(errorText(cause)),
    )
  }, [invoke])
  useEffect(() => {
    reload()
    void invoke('projects.list').then(setProjects, () => {})
    const offChanged = on('plugins:changed', reload)
    const offFailed = on('plugins:signInFailed', ({ message }) => setError(message))
    return () => {
      offChanged()
      offFailed()
    }
  }, [invoke, on, reload])
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  /** Where each Development plugin was shared to, by plugin id. */
  const [shared, setShared] = useState<Record<string, string>>({})
  // A link from getramu.dev opens the review straight away.
  useEffect(() => {
    if (link)
      void act(async () =>
        setReview(await invoke('plugins.stage', { source: link.source, ...(link.index ? { index: link.index } : {}) })),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the link the page opened with
  }, [link])
  const installed = plugins ?? []
  const shown = (listings ?? []).filter((listing) => listingMatches(listing, query))
  const indexProblems = indexes.filter((index) => index.error)
  return (
    <section className="flex flex-col gap-2" aria-label={t('Plugins')}>
      <div className="mb-1 flex items-start justify-between gap-4">
        <p className="m-0 max-w-[560px] text-caption text-muted-foreground">
          {t(
            'One install adds a service’s skills, MCP servers, credential and safe commands for every provider. Plugins in the Claude Code and Codex layout work here too.',
          )}
        </p>
        {installed.some((plugin) => plugin.source.kind === 'git') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={viewOnly || busy}
            onClick={() => void act(async () => setPlugins(await invoke('plugins.checkUpdates')))}
          >
            <RefreshCw size={13} />
            {t('Check for updates')}
          </Button>
        )}
      </div>
      {error && !review && <Problem>{error}</Problem>}
      <SettingsSectionHead title={plugins ? t('Installed · {count}', { count: installed.length }) : t('Installed')} />
      <SettingsCardList>
        {!plugins && !error && <ContentSkeleton />}
        {plugins && !installed.length && (
          <SettingsEmpty>
            {t('Nothing installed yet. Pick a plugin below; each one shows what it adds first.')}
          </SettingsEmpty>
        )}
        {installed.map((plugin) => {
          const missing = plugin.credentials.filter((slot) => slot.state !== 'saved')
          return (
            <article key={plugin.id} className={`${SETTINGS_CARD} gap-2! px-3.5! py-3!`}>
              {/* The name and its facts on the left, the controls in one fixed group on the right, so neither
                  squeezes the other. */}
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-control font-medium">{plugin.name}</strong>
                    {plugin.byRamu && <Badge variant="secondary">{t('By Ramu')}</Badge>}
                    {plugin.source.kind === 'development' && <Badge variant="outline">{t('Development')}</Badge>}
                    {plugin.source.kind === 'git' &&
                      (plugin.source.signedBy ? (
                        <Badge
                          variant="outline"
                          title={t('Signed by {name}', { name: plugin.source.signedBy })}
                          className="gap-1"
                        >
                          <ShieldCheck size={11} aria-hidden />
                          {t('Signed')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-warn">
                          {t('Unsigned')}
                        </Badge>
                      ))}
                    {missing.length > 0 && (
                      <Badge variant="outline" className="border-warn/40 text-warn">
                        {t('Needs {what}', { what: missing.map((slot) => slot.label).join(', ') })}
                      </Badge>
                    )}
                  </div>
                  <p
                    className="m-0 line-clamp-2 text-caption text-muted-foreground"
                    title={plugin.contents.description}
                  >
                    {[
                      plugin.contents.description,
                      plugin.scope.kind === 'project'
                        ? (projects.find((project) => project.id === (plugin.scope as { projectId: string }).projectId)
                            ?.name ?? t('One project'))
                        : t('All projects'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <AccountIdentityPicker
                    accountKey={accountKey('plugin', plugin.id)}
                    name={plugin.name}
                    disabled={viewOnly || busy}
                  />
                  {plugin.update && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={viewOnly || busy}
                      onClick={() => void act(async () => setReview(await invoke('plugins.updateReview', plugin.id)))}
                    >
                      {t('Update')}
                    </Button>
                  )}
                  <Switch
                    aria-label={t('Use {name}', { name: plugin.name })}
                    title={plugin.enabled ? t('On') : t('Off')}
                    checked={plugin.enabled}
                    disabled={viewOnly || busy}
                    onCheckedChange={(enabled) =>
                      void act(async () => {
                        // The answer is the plugin as saved, so the switch shows it at once; the reload brings
                        // the rest of the page (credentials, updates) in line.
                        const saved = await invoke('plugins.setEnabled', plugin.id, enabled)
                        setPlugins(
                          (current) => current?.map((entry) => (entry.id === saved.id ? saved : entry)) ?? null,
                        )
                        reload()
                      })
                    }
                  />
                  {plugin.source.kind === 'development' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('Push this folder to a private repository on your GitHub account')}
                      disabled={viewOnly || busy}
                      onClick={() =>
                        void act(async () => {
                          const { url } = await invoke('plugins.share', plugin.id)
                          setShared((current) => ({ ...current, [plugin.id]: url }))
                        })
                      }
                    >
                      <Share2 size={13} />
                      {t('Share')}
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('Remove {name}', { name: plugin.name })}
                    title={t('Remove {name}', { name: plugin.name })}
                    disabled={viewOnly || busy}
                    onClick={() => setRemoving(plugin)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              {shared[plugin.id] && (
                <p className="m-0 text-caption text-muted-foreground" role="status">
                  {t('Shared to {url}. Open a pull request to an index from there to get it listed.', {
                    url: shared[plugin.id]!,
                  })}
                </p>
              )}
              {plugin.update && plugin.update.changes.length > 0 && (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Update: {changes}', { changes: plugin.update.changes.join('; ') })}
                </p>
              )}
              {plugin.contents.unused.length > 0 && (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Not used in Ramu: {parts}', {
                    parts: plugin.contents.unused.map((part) => t(UNUSED_PART_NAMES[part])).join(', '),
                  })}
                </p>
              )}
              {plugin.credentials.map((slot) => (
                <Credential key={slot.id} plugin={plugin} slot={slot} viewOnly={viewOnly} onChanged={reload} />
              ))}
            </article>
          )
        })}
      </SettingsCardList>

      <SettingsSectionHead
        title={listings ? t('Available · {count}', { count: listings.length }) : t('Available')}
        help={t('From the indexes Ramu reads. Each one shows what it adds before anything is installed.')}
      />
      <SearchInput
        aria-label={t('Search plugins')}
        placeholder={t('Filter by name or what it is for, such as render or analytics')}
        value={query}
        maxLength={200}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      {listingError && <Problem>{listingError}</Problem>}
      {indexProblems.map((index) => (
        <Problem key={index.url}>
          {t('{name} could not be read: {error}', { name: index.name, error: index.error! })}
        </Problem>
      ))}
      {!listings && !listingError && <ContentSkeleton />}
      {listings && !shown.length && (
        <SettingsEmpty>
          {query.trim()
            ? t('No listed plugin matches “{query}”.', { query: query.trim() })
            : t('The indexes list no plugins yet.')}
        </SettingsEmpty>
      )}
      {shown.length > 0 && (
        <SettingsCardList>
          {shown.map((listing) => (
            <SettingsCard
              key={`${listing.index}:${listing.name}`}
              title={listing.name}
              badges={
                <>
                  {listing.byRamu && <Badge variant="secondary">{t('By Ramu')}</Badge>}
                  {!listing.signed && <Badge variant="outline">{t('Unsigned')}</Badge>}
                </>
              }
              meta={[listing.description, indexes.length > 1 ? listing.indexName : ''].filter(Boolean).join(' · ')}
              actions={
                listing.installed ? (
                  <Badge variant="outline">{t('Installed')}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={viewOnly || busy}
                    onClick={() =>
                      void act(async () =>
                        setReview(await invoke('plugins.stage', { source: listing.name, index: listing.index })),
                      )
                    }
                  >
                    <Download size={13} />
                    {t('Install')}
                  </Button>
                )
              }
            />
          ))}
        </SettingsCardList>
      )}

      <ExpandRow expanded={more} onToggle={() => setMore((value) => !value)} className="mt-3 rounded-(--radius-s) px-1">
        {t('Install from a Git address or folder, or add an index')}
      </ExpandRow>
      {more && (
        <div className="flex flex-col gap-2">
          <SettingsSectionHead
            title={t('Install from a source')}
            help={t('A Git address (GitHub, GitLab, or anywhere git can clone) or a folder on this computer.')}
          />
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(async () => setReview(await invoke('plugins.stage', { source: source.trim() })))
            }}
          >
            <Input
              aria-label={t('Plugin source')}
              className="min-w-0 flex-1"
              placeholder="https://github.com/acme/render-plugin"
              value={source}
              maxLength={1000}
              disabled={viewOnly}
              onChange={(event) => setSource(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={viewOnly || busy || !source.trim()}>
              {busy ? t('Reading…') : t('Review')}
            </Button>
          </form>

          <SettingsSectionHead
            title={t('Indexes')}
            help={t('Marketplaces Available lists. Claude Code marketplaces work too.')}
          />
          <SettingsCardList>
            {indexes.map((index) => (
              <SettingsCard
                key={index.url}
                title={index.name}
                badges={index.builtIn ? <Badge variant="secondary">{t('Built in')}</Badge> : undefined}
                meta={[index.url, index.error ?? (index.checkedAt ? t('{count} plugins', { count: index.count }) : '')]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  !index.builtIn && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('Remove {name}', { name: index.name })}
                      disabled={viewOnly || busy}
                      onClick={() =>
                        void act(async () => {
                          setIndexes(await invoke('plugins.removeIndex', index.url))
                          reload()
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </Button>
                  )
                }
              />
            ))}
          </SettingsCardList>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(async () => {
                setIndexes(await invoke('plugins.addIndex', newIndex.trim()))
                setNewIndex('')
                reload()
              })
            }}
          >
            <Input
              aria-label={t('Index address')}
              className="min-w-0 flex-1"
              placeholder="https://github.com/acme/plugins"
              value={newIndex}
              maxLength={1000}
              disabled={viewOnly}
              onChange={(event) => setNewIndex(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={viewOnly || busy || !newIndex.trim()}>
              {t('Add index')}
            </Button>
          </form>
        </div>
      )}

      {review && (
        <Review
          review={review}
          projects={projects}
          busy={busy}
          error={error}
          onCancel={() => {
            void invoke('plugins.cancel', review.stageId).catch(() => {})
            setReview(null)
            setError(null)
          }}
          onConfirm={(options) =>
            void act(async () => {
              await invoke('plugins.confirm', review.stageId, options)
              setReview(null)
              setSource('')
              reload()
            })
          }
        />
      )}
      {removing && (
        <Dialog
          title={t('Remove {name}?', { name: removing.name })}
          confirmLabel={t('Remove')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void act(async () => {
              await invoke('plugins.remove', removing.id)
              setRemoving(null)
              reload()
            })
          }
        >
          {t(
            'Its skills, MCP servers, custom agents, rule and saved credentials are removed together. Threads already running keep the tools they started with until they restart.',
          )}
        </Dialog>
      )}
    </section>
  )
}
