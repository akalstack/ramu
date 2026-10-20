import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentProvider } from '@ramu/shared/types'
import type { ProjectMcpServer, ProjectSetupSource } from '@ramu/shared/mcp'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { Input } from '@/components/desktop-input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { ProviderIcon } from '../models/ProviderIcon'
import { useWorkspace } from '../workspace/workspace'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList, usePaged } from './cards'
import { McpSettings } from './McpSettings'

const CAPTION = 'm-0 text-caption text-muted-foreground'

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
function fromText(sources: ProjectSetupSource[]) {
  const places = [
    ...new Set(sources.map((source) => (source.scope === 'user' ? source.file : `${source.label}/${source.file}`))),
  ]
  const shown = places.slice(0, 2).join(', ')
  return places.length > 2 ? t('{places} and {count} more', { places: shown, count: places.length - 2 }) : shown
}

function serverStatus(server: ProjectMcpServer) {
  if (server.shared) return t('Every provider and account')
  if (server.shareBlocked) return t(server.shareBlocked)
  if (!server.nativeProviders.length) return t('Turned off in every provider')
  return t('Only {providers}', { providers: server.nativeProviders.map(providerName).join(', ') })
}

function ServerRow({
  server,
  disabled,
  onShare,
}: {
  server: ProjectMcpServer
  disabled: boolean
  onShare(shared: boolean): void
}) {
  const location =
    server.transport.type === 'http'
      ? server.transport.url
      : [server.transport.command, ...server.transport.args].join(' ')
  return (
    <SettingsRow>
      <span>
        <span className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 truncate">{server.name}</strong>
          <ProviderStrip providers={server.providers} />
        </span>
        <span className="block truncate small text-caption text-muted-foreground" title={location}>
          {location}
        </span>
        <span className="block small text-caption text-muted-foreground">
          {serverStatus(server)} · {t('From {places}', { places: fromText(server.sources) })}
        </span>
      </span>
      <Switch
        aria-label={t('Share {name} with every provider and account', { name: server.name })}
        checked={server.shared}
        disabled={disabled || !!server.shareBlocked || !server.nativeProviders.length}
        onCheckedChange={onShare}
      />
    </SettingsRow>
  )
}

/**
 * Settings → Agent setup. For one project: the MCP servers declared anywhere agents look (each provider's own
 * settings, Claude's local scope, the project's repositories), each with one switch that gives it to every provider
 * and account; then servers connected through Ramu, then the skills found in the same places.
 */
export function AgentSetup() {
  useLanguage()
  const invoke = useSettingsInvoke(),
    on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const ready = !scope || (scope.ready && !scope.stale)
  const ws = useWorkspace()
  const projects = useQuery({
    queryKey: ['mcp-projects', hostKey],
    queryFn: () => invoke('projects.list'),
    enabled: ready,
  })
  const status = useQuery({ queryKey: ['mcp-settings', hostKey], queryFn: () => invoke('mcp.status'), enabled: ready })
  const [picked, setPicked] = useState<string>()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    setPicked(undefined)
    setPending(null)
    setError('')
  }, [hostKey])
  const projectId =
    projects.data?.find((project) => project.id === (picked ?? ws.composing))?.id ?? projects.data?.[0]?.id
  const setup = useQuery({
    queryKey: ['project-setup', hostKey, projectId],
    queryFn: () => invoke('projects.setup', projectId!),
    enabled: !!projectId && ready,
  })
  const refetch = setup.refetch
  useEffect(
    () =>
      on('mcp:changed', () => {
        void refetch()
      }),
    [on, refetch],
  )
  const canAdminister = status.data?.canAdminister === true && ready
  const share = async (server: ProjectMcpServer, shared: boolean) => {
    const current = epoch.current
    setPending(server.key)
    setError('')
    try {
      await invoke('mcp.share', server.key, shared)
      if (current === epoch.current) await refetch()
    } catch (reason) {
      if (current === epoch.current) setError(errorText(reason))
    } finally {
      if (current === epoch.current) setPending(null)
    }
  }
  const query = search.trim().toLowerCase()
  const skills = (setup.data?.skills ?? []).filter(
    (skill) => !query || skill.name.includes(query) || skill.description.toLowerCase().includes(query),
  )
  const paged = usePaged(skills, 10)
  return (
    <div className="flex flex-col">
      {projects.data && projects.data.length > 0 && (
        <SettingsRow>
          <SettingsLabel
            title={t('Project')}
            help={t('Shows what agents get in this project, including servers from your own provider settings.')}
          />
          <Dropdown
            label={t('Project')}
            value={projectId ?? ''}
            options={projects.data.map((project) => ({ value: project.id, label: project.name }))}
            onChange={setPicked}
          />
        </SettingsRow>
      )}

      <SettingsGroupTitle>{t('MCP servers')}</SettingsGroupTitle>
      <p className={`${CAPTION} mb-3`}>
        {t(
          'Turn on sharing to give a server to every provider and every account, with the sign-in it already has. New threads pick up changes.',
        )}
      </p>
      {(error || setup.error || projects.error) && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error || errorText(setup.error ?? projects.error)}</AlertDescription>
        </Alert>
      )}
      {!setup.data && !setup.error && !!projectId && (
        <p role="status" className={`${CAPTION} mb-4`}>
          {t('Loading…')}
        </p>
      )}
      {setup.data?.mcp.length === 0 && (
        <p className={`${CAPTION} mb-4`}>{t('No MCP servers in your provider settings or this project.')}</p>
      )}
      {setup.data?.mcp.map((server) => (
        <ServerRow
          key={server.key}
          server={server}
          disabled={!canAdminister || pending !== null}
          onShare={(shared) => void share(server, shared)}
        />
      ))}
      {setup.data && setup.data.diagnostics.length > 0 && (
        <details className={`${CAPTION} mb-4`}>
          <summary className="cursor-pointer select-none">
            {t('{count} files could not be read', { count: setup.data.diagnostics.length })}
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {setup.data.diagnostics.map((item) => (
              <li key={item.file} className="break-all">
                {item.file}: {item.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4">
        <McpSettings />
      </div>

      <SettingsGroupTitle className="mt-8">{t('Skills')}</SettingsGroupTitle>
      <p className={`${CAPTION} mb-3`}>
        {t(
          'Skills in these folders load in the providers shown. Install skills for every provider in Memory & skills.',
        )}
      </p>
      {(setup.data?.skills.length ?? 0) > 10 && (
        <div className="mb-3">
          <Input
            aria-label={t('Search skills')}
            placeholder={t('Search skills')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}
      {setup.data?.skills.length === 0 && (
        <p className={CAPTION}>{t('No skills in your user folders or this project.')}</p>
      )}
      <SettingsCardList>
        {paged.shown.map((skill) => (
          <SettingsCard
            key={skill.name}
            title={skill.name}
            badges={
              <>
                <ProviderStrip providers={skill.providers} />
                {skill.nameConflict && <Badge variant="outline">{t('Differs between copies')}</Badge>}
              </>
            }
            meta={skill.description}
          >
            <p className={`${CAPTION} truncate`}>{t('From {places}', { places: fromText(skill.sources) })}</p>
          </SettingsCard>
        ))}
        {paged.more}
      </SettingsCardList>
    </div>
  )
}
