import { InlineAction, InlineLink } from '@/components/inline-action'
import { useStaging } from './stagedChanges'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentProvider } from '@ramu/shared/types'
import {
  setupFromText,
  setupReachText,
  type ProjectMcpServer,
  type ProjectSetupSource,
  type ProjectSkill,
} from '@ramu/shared/mcp'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dialog, Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { ramu } from '../ipc'
import { ProviderIcon } from '../models/ProviderIcon'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { usePaged } from './cards'
import { McpSettings } from './McpSettings'
import { RulesSettings } from './RulesSettings'

const CAPTION = 'm-0 text-caption text-muted-foreground'

export type SetupView = 'mcp' | 'skills' | 'rules'

/** An empty list says so inside a soft panel instead of leaving bare text between headings. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="m-0 mb-4 rounded-(--radius-m) bg-fill px-4 py-6 text-center text-caption text-muted-foreground"
    >
      {children}
    </p>
  )
}

/** Claude's own help page on connectors, which says where to manage them. Other providers have no such page Ramu can point to yet. */
const CLAUDE_CONNECTORS_URL =
  'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities'

/** Provider logos, dimmed where the item is missing, with the same information as text for screen readers. */
function ProviderStrip({ providers }: { providers: AgentProvider[] }) {
  const missing = AGENT_PROVIDERS.filter((provider) => !providers.includes(provider))
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <span className="sr-only">
        {providers.length
          ? t('Available in {providers}', { providers: providers.map(providerName).join(', ') })
          : t('Not available in any provider')}
      </span>
      {AGENT_PROVIDERS.map((provider) => (
        <span
          key={provider}
          aria-hidden
          title={`${providerName(provider)}${missing.includes(provider) ? ` · ${t('Not available')}` : ''}`}
          className={missing.includes(provider) ? 'opacity-25' : 'text-foreground'}
        >
          <ProviderIcon provider={provider} size={13} />
        </span>
      ))}
    </span>
  )
}

/** Where something is declared, briefly: the first two places and a count of the rest. */
const fromText = (sources: ProjectSetupSource[]) => setupFromText(sources, t)

type Shareable = Pick<ProjectMcpServer, 'shared' | 'shareBlocked' | 'nativeProviders' | 'shareScope' | 'exceptions'>

/** One line on who has it now: shared, only some providers, or off everywhere. */
const reach = (item: Shareable) => setupReachText(item, t, providerName)

/** A name, who has it, where it comes from, and the one switch that shares it. */
function ShareRow({
  name,
  detail,
  item,
  providers,
  sources,
  label,
  disabled,
  onShare,
  onReset,
  extra,
}: {
  name: string
  detail: string
  item: Shareable
  providers: AgentProvider[]
  sources: ProjectSetupSource[]
  label: string
  disabled: boolean
  onShare(shared: boolean): void
  /** Offered when this project made its own choice: drops it so the all-projects setting applies again. */
  onReset?(): void
  /** An item-specific action beside the switch. */
  extra?: ReactNode
}) {
  return (
    <SettingsRow>
      <span>
        <span className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 truncate">{name}</strong>
          <ProviderStrip providers={providers} />
        </span>
        <span className="block truncate small text-caption text-muted-foreground" title={detail}>
          {detail}
        </span>
        <span className="block small text-caption text-muted-foreground">
          {reach(item)} · {t('From {places}', { places: fromText(sources) })}
          {!!item.exceptions && (
            <>
              {' '}
              ·{' '}
              {t(item.exceptions === 1 ? 'Different in 1 project' : 'Different in {count} projects', {
                count: item.exceptions,
              })}
            </>
          )}
          {onReset && item.shareScope === 'project' && (
            <>
              {' · '}
              <InlineAction disabled={disabled} onClick={onReset}>
                {t('Use the all-projects setting')}
              </InlineAction>
            </>
          )}
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        {extra}
        <Switch
          aria-label={label}
          checked={item.shared}
          disabled={disabled || !!item.shareBlocked || !item.nativeProviders.length}
          onCheckedChange={onShare}
        />
      </span>
    </SettingsRow>
  )
}

/**
 * Previews what importing a declared server into Shared MCP copies (its address or command, never its values) and
 * where it will apply, then asks before saving. Nothing runs and no provider file changes.
 */
function ImportDialog({
  server,
  projectName,
  hostName,
  busy,
  error,
  onCancel,
  onImport,
}: {
  server: ProjectMcpServer
  projectName: string
  hostName: string
  busy: boolean
  error: string
  onCancel(): void
  onImport(providers: AgentProvider[]): void
}) {
  const [providers, setProviders] = useState<AgentProvider[]>(
    server.nativeProviders.length ? server.nativeProviders : [...AGENT_PROVIDERS],
  )
  const secretNames = [...server.envKeys, ...server.headerKeys]
  return (
    <Dialog
      title={t('Connect {name} through Ramu', { name: server.name })}
      confirmLabel={t('Import')}
      busy={busy}
      error={error}
      confirmDisabled={!providers.length}
      onCancel={onCancel}
      onConfirm={() => onImport(providers)}
    >
      <p>{t('Connection host: {host}', { host: hostName })}</p>
      <p>
        {server.transport.type === 'http'
          ? t('Remote server: {target}', { target: server.transport.url })
          : t('Runs on the host: {target}', {
              target: [server.transport.command, ...server.transport.args].join(' '),
            })}
      </p>
      <p>{t('Applies to {project} only. Widen it later in the server’s settings.', { project: projectName })}</p>
      {secretNames.length > 0 && (
        <p>
          {t(
            'Its values for {names} stay in the original file. Ramu copies none of them; enter them as write-only secrets after importing.',
            { names: secretNames.join(', ') },
          )}
        </p>
      )}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend>{t('Providers')}</legend>
        {AGENT_PROVIDERS.map((provider) => (
          <Field key={provider} orientation="horizontal">
            <Checkbox
              id={`import-${provider}`}
              checked={providers.includes(provider)}
              onCheckedChange={(checked) =>
                setProviders((current) =>
                  checked ? [...current, provider] : current.filter((entry) => entry !== provider),
                )
              }
            />
            <FieldLabel htmlFor={`import-${provider}`}>{providerName(provider)}</FieldLabel>
          </Field>
        ))}
      </fieldset>
      <p>{t('Importing does not connect or run anything. Review its tools when you connect.')}</p>
    </Dialog>
  )
}

/** A titled run of rows. `user` items come from the person's own provider files; `project` from the project's folders. */
function Group({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h5 className="m-0 text-control font-medium">{title}</h5>
      <p className={`${CAPTION} mb-2 mt-0.5`}>{help}</p>
      {children}
    </section>
  )
}

function Skills({
  skills,
  disabled,
  onShare,
  onReset,
  query,
}: {
  skills: ProjectSkill[]
  disabled: boolean
  onShare(name: string, shared: boolean): void
  /** Absent in the all-projects view, where there is no project choice to drop. */
  onReset?(name: string): void
  /** Paging starts over when the search changes. */
  query: string
}) {
  const paged = usePaged(skills, 10, query)
  return (
    <>
      {paged.shown.map((skill) => (
        <ShareRow
          key={skill.name}
          name={skill.name}
          detail={
            skill.nameConflict ? `${skill.description} · ${t('Different content shares this name')}` : skill.description
          }
          item={skill}
          providers={skill.providers}
          sources={skill.sources}
          label={t('Share {name} with every provider and account', { name: skill.name })}
          disabled={disabled}
          onShare={(shared) => onShare(skill.name, shared)}
          onReset={onReset && (() => onReset(skill.name))}
        />
      ))}
      {paged.more}
    </>
  )
}

/**
 * Settings → Agent setup. For one project, what its agents get: MCP servers and skills from the person's own provider
 * files (every project) and from the project's folders, each with one switch that gives it to every provider and
 * account, followed by servers connected through Ramu itself.
 */
export function AgentSetup({ initialView = 'mcp' }: { initialView?: SetupView }) {
  useLanguage()
  const invoke = useSettingsInvoke(),
    on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
  const ready = !scope || (scope.ready && !scope.stale)
  const projects = useQuery({
    queryKey: ['mcp-projects', hostKey],
    queryFn: () => invoke('projects.list'),
    enabled: ready,
  })
  const status = useQuery({ queryKey: ['mcp-settings', hostKey], queryFn: () => invoke('mcp.status'), enabled: ready })
  const [view, setView] = useState<SetupView>(initialView)
  const [picked, setPicked] = useState<string>()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState<ProjectMcpServer | null>(null)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    setPicked(undefined)
    setImporting(null)
    setPending(null)
    setError('')
  }, [hostKey])
  // All projects unless one is picked: most choices are meant for every project, and a project is where exceptions go.
  const projectId = projects.data?.find((project) => project.id === picked)?.id ?? null
  const setup = useQuery({
    queryKey: ['project-setup', hostKey, projectId ?? 'all'],
    queryFn: () => invoke('projects.setup', projectId),
    enabled: ready,
  })
  const where = projectId ?? 'all'
  const refetch = setup.refetch
  useEffect(
    () =>
      on('mcp:changed', () => {
        void refetch()
      }),
    [on, refetch],
  )
  const canAdminister = status.data?.canAdminister === true && ready && !viewOnly
  const { valueOf, stage } = useStaging()
  const share = async (id: string, work: () => Promise<unknown>) => {
    const current = epoch.current
    setPending(id)
    setError('')
    try {
      await work()
      if (current === epoch.current) await refetch()
    } catch (reason) {
      if (current === epoch.current) setError(errorText(reason))
    } finally {
      if (current === epoch.current) setPending(null)
    }
  }
  const data = setup.data
  const mcp = (scopeName: 'user' | 'project') => (data?.mcp ?? []).filter((server) => server.scope === scopeName)
  const query = search.trim().toLowerCase()
  const skills = (data?.skills ?? []).filter(
    (skill) => !query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
  )
  const skillsIn = (scopeName: 'user' | 'project') => skills.filter((skill) => skill.scope === scopeName)
  const locked = !canAdminister || pending !== null
  const servers = (scopeName: 'user' | 'project') =>
    mcp(scopeName).map((server) => (
      <ShareRow
        key={server.key}
        name={server.name}
        detail={
          server.transport.type === 'http'
            ? server.transport.url
            : [server.transport.command, ...server.transport.args].join(' ')
        }
        item={{ ...server, shared: valueOf(`mcp-share:${where}:${server.key}`, server.shared) }}
        providers={server.providers}
        sources={server.sources}
        label={t('Share {name} with every provider and account', { name: server.name })}
        disabled={locked}
        onShare={(shared) =>
          stage(`mcp-share:${where}:${server.key}`, shared, server.shared, (value) =>
            share(server.key, () => invoke('mcp.share', server.key, value, projectId ?? undefined)),
          )
        }
        extra={
          server.managedConnectionId ? (
            <span className="text-caption text-muted-foreground">{t('Connected through Ramu')}</span>
          ) : projectId ? (
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setImporting(server)}>
              {t('Connect through Ramu')}
            </Button>
          ) : null
        }
        onReset={
          projectId ? () => void share(server.key, () => invoke('mcp.share', server.key, null, projectId)) : undefined
        }
      />
    ))
  const skillList = (scopeName: 'user' | 'project') => (
    <Skills
      skills={skillsIn(scopeName).map((skill) => ({
        ...skill,
        shared: valueOf(`skill-share:${where}:${skill.name}`, skill.shared),
      }))}
      query={query}
      disabled={locked}
      onShare={(name, shared) =>
        stage(
          `skill-share:${where}:${name}`,
          shared,
          skillsIn(scopeName).find((skill) => skill.name === name)?.shared ?? false,
          (value) => share(name, () => invoke('skills.share', name, value, projectId ?? undefined)),
        )
      }
      onReset={projectId ? (name) => void share(name, () => invoke('skills.share', name, null, projectId)) : undefined}
    />
  )
  const projectName = projects.data?.find((project) => project.id === projectId)?.name
  const mcpCount = mcp('user').length + mcp('project').length
  return (
    <Tabs value={view} onValueChange={(next) => setView(next as SetupView)} className="flex-col gap-5">
      <TabsList variant="line" className="h-9! w-full justify-start gap-4 border-b border-(--line) p-0">
        <TabsTrigger value="mcp" className="flex-none gap-1.5 px-0.5 text-control">
          {t('MCP servers')}
          {mcpCount > 0 && <span className="text-caption text-muted-foreground">{mcpCount}</span>}
        </TabsTrigger>
        <TabsTrigger value="skills" className="flex-none gap-1.5 px-0.5 text-control">
          {t('Skills')}
          {!!data?.skills.length && <span className="text-caption text-muted-foreground">{data.skills.length}</span>}
        </TabsTrigger>
        <TabsTrigger value="rules" className="flex-none px-0.5 text-control">
          {t('Rules')}
        </TabsTrigger>
      </TabsList>
      {view !== 'rules' && projects.data && projects.data.length > 0 && (
        <SettingsRow className="mb-0">
          <SettingsLabel
            title={t('Applies to')}
            help={
              projectId
                ? t('A switch here makes an exception for {project} only.', { project: projectName ?? '' })
                : t('Every project. Choose one to see its own servers and skills, or to make an exception.')
            }
          />
          <Dropdown
            label={t('Applies to')}
            value={projectId ?? ''}
            options={[
              { value: '', label: t('All projects') },
              ...projects.data.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={setPicked}
          />
        </SettingsRow>
      )}
      {view !== 'rules' && (error || setup.error || projects.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || errorText(setup.error ?? projects.error)}</AlertDescription>
        </Alert>
      )}
      {view !== 'rules' && !data && !setup.error && (
        <p role="status" className={CAPTION}>
          {t('Loading…')}
        </p>
      )}

      <TabsContent value="mcp" className="flex flex-col">
        <p className={`${CAPTION} mb-4`}>
          {projectId
            ? t(
                'Tools agents can call. Sharing a server gives it to every provider and account in this project. New threads pick up changes.',
              )
            : t(
                'Tools agents can call. Sharing a server gives it to every provider and account in every project. New threads pick up changes.',
              )}
        </p>
        {data && mcpCount === 0 && <EmptyNote>{t('No MCP servers found yet.')}</EmptyNote>}
        {mcp('user').length > 0 && (
          <Group title={t('Your settings')} help={t('From your own provider files, so every project has them.')}>
            {servers('user')}
          </Group>
        )}
        {mcp('project').length > 0 && (
          <Group
            title={projectName ? t('{project} only', { project: projectName }) : t('This project')}
            help={t('From the project’s repositories and Claude’s per-project list.')}
          >
            {servers('project')}
          </Group>
        )}
        {data?.providerManaged && data.providerManaged.length > 0 && (
          <Group
            title={t('Managed by the provider')}
            help={t(
              'Seen in an earlier thread. Only the provider holds their definitions, so Ramu cannot share them. To share one, add it below as a Ramu MCP server.',
            )}
          >
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {data.providerManaged.map((item) => (
                <li key={`${item.provider}:${item.name}`} className="flex items-center gap-2">
                  <strong className="min-w-0 truncate">{item.name}</strong>
                  <span className={CAPTION}>{providerName(item.provider)}</span>
                  {item.provider === 'claude-code' && (
                    <InlineLink
                      href={CLAUDE_CONNECTORS_URL}
                      onClick={(event) => {
                        event.preventDefault()
                        void ramu.invoke('app.openExternal', CLAUDE_CONNECTORS_URL).catch(() => {})
                      }}
                    >
                      {t('Manage connectors')}
                    </InlineLink>
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}
        {data && data.diagnostics.length > 0 && (
          <details className={`${CAPTION} mb-4`}>
            <summary className="cursor-pointer select-none">
              {t('{count} files could not be read', { count: data.diagnostics.length })}
            </summary>
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {data.diagnostics.map((item) => (
                <li key={item.file} className="break-all">
                  {item.file}: {item.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {importing && projectId && (
          <ImportDialog
            server={importing}
            projectName={projectName ?? ''}
            hostName={scope?.available.find((host) => host.id === scope.primaryId)?.name ?? t('This host')}
            busy={pending !== null}
            error={error}
            onCancel={() => {
              if (pending === null) setImporting(null)
            }}
            onImport={(providers) =>
              void share(importing.key, async () => {
                await invoke('mcp.import', importing.key, projectId, providers)
                setImporting(null)
              })
            }
          />
        )}

        <McpSettings />
      </TabsContent>

      <TabsContent value="rules" className="flex flex-col">
        <RulesSettings />
      </TabsContent>

      <TabsContent value="skills" className="flex flex-col">
        <p className={`${CAPTION} mb-4`}>
          {projectId
            ? t(
                'Instructions agents can load. Sharing a skill copies it to every provider and account in this project that lacks it. Original files stay unchanged.',
              )
            : t(
                'Instructions agents can load. Sharing a skill copies it to every provider and account in every project that lacks it. Original files stay unchanged.',
              )}
        </p>
        {(data?.skills.length ?? 0) > 10 && (
          <div className="mb-4">
            <Input
              aria-label={t('Search skills')}
              placeholder={t('Search skills')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        {data?.skills.length === 0 && <EmptyNote>{t('No skills found yet.')}</EmptyNote>}
        {!!data?.skills.length && skills.length === 0 && (
          <p role="status" className={CAPTION}>
            {t('No skills match your search.')}
          </p>
        )}
        {skillsIn('user').length > 0 && (
          <Group title={t('Your settings')} help={t('From your own provider folders, so every project has them.')}>
            {skillList('user')}
          </Group>
        )}
        {skillsIn('project').length > 0 && (
          <Group
            title={projectName ? t('{project} only', { project: projectName }) : t('This project')}
            help={t('From the project’s repositories.')}
          >
            {skillList('project')}
          </Group>
        )}
      </TabsContent>
    </Tabs>
  )
}
