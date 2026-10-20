import { useContext, useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentProvider, Project } from '@ramu/shared/types'
import type { SharedMcpConnection, SharedMcpInspection, SharedMcpSelection } from '@ramu/shared/mcp'
import { AGENT_PROVIDERS, providerName, providerAccountRows } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dialog, Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useWorkspace } from '../workspace/workspace'
import { useModelSets } from '../models/ModelSets'
import { useAppSettings } from './AppSettings'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList } from './cards'

type Definition = Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>
const statusLabels = {
  disabled: 'Disabled',
  'not-connected': 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  failed: 'Connection failed',
  unsupported: 'Unsupported',
  'sign-in-required': 'Sign-in required',
  'insufficient-permission': 'Insufficient permission',
}

function ConnectionEditor({
  initial,
  projects,
  defaultProject,
  defaultProvider,
  hostName,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial?: SharedMcpConnection
  projects: Project[]
  defaultProject?: string
  defaultProvider: AgentProvider
  hostName: string
  busy: boolean
  error?: string
  onSave(value: Definition): void
  onCancel(): void
}) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.transport.type === 'http' ? initial.transport.url : '')
  const [providers, setProviders] = useState<AgentProvider[]>(initial?.providers ?? [defaultProvider])
  const [scope, setScope] = useState(
    initial?.scope ?? { projectIds: defaultProject ? [defaultProject] : [], hostWide: false },
  )
  // Existing stdio definitions are kept intact; adding local commands belongs in the advanced editor.
  const editable = !initial || initial.transport.type === 'http'
  const save = () =>
    onSave({
      name,
      serviceAccountId: initial?.serviceAccountId ?? 'public',
      enabled: initial?.enabled ?? true,
      scope,
      providers,
      transport: editable
        ? {
            type: 'http',
            url,
            headerSecretRefs: initial?.transport.type === 'http' ? initial.transport.headerSecretRefs : {},
            ...(initial?.transport.type === 'http' && initial.transport.allowPrivateNetwork
              ? { allowPrivateNetwork: true }
              : {}),
          }
        : initial!.transport,
    })
  return (
    <Dialog
      title={t(initial ? 'Edit MCP server' : 'Add MCP server')}
      confirmLabel={t('Save')}
      onCancel={onCancel}
      onConfirm={() => form.current?.requestSubmit()}
      busy={busy}
      error={error}
      confirmDisabled={!name.trim() || !providers.length || (!scope.hostWide && !scope.projectIds.length)}
    >
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <p>{t('Connection host: {host}', { host: hostName })}</p>
        <fieldset disabled={busy} className="m-0 flex flex-col gap-4 border-0 p-0">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{t('Name')}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </Field>
          {editable && (
            <Field>
              <FieldLabel htmlFor={`${id}-url`}>{t('Server URL')}</FieldLabel>
              <Input
                id={`${id}-url`}
                type="url"
                placeholder="https://mcp.deepwiki.com/mcp"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </Field>
          )}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend>{t('Providers')}</legend>
            {AGENT_PROVIDERS.map((provider) => (
              <Field key={provider} orientation="horizontal">
                <Checkbox
                  id={`${id}-${provider}`}
                  checked={providers.includes(provider)}
                  onCheckedChange={(checked) =>
                    setProviders((current) =>
                      checked ? [...current, provider] : current.filter((entry) => entry !== provider),
                    )
                  }
                />
                <FieldLabel htmlFor={`${id}-${provider}`}>{providerName(provider)}</FieldLabel>
              </Field>
            ))}
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend>{t('Project access')}</legend>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-host`}
                checked={scope.hostWide}
                onCheckedChange={(hostWide) => setScope((current) => ({ ...current, hostWide }))}
              />
              <FieldLabel htmlFor={`${id}-host`}>{t('All projects and no-project threads on this host')}</FieldLabel>
            </Field>
            {!scope.hostWide &&
              projects.map((project) => (
                <Field key={project.id} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${project.id}`}
                    checked={scope.projectIds.includes(project.id)}
                    onCheckedChange={(checked) =>
                      setScope((current) => ({
                        ...current,
                        projectIds: checked
                          ? [...current.projectIds, project.id]
                          : current.projectIds.filter((entry) => entry !== project.id),
                      }))
                    }
                  />
                  <FieldLabel htmlFor={`${id}-${project.id}`}>{project.name}</FieldLabel>
                </Field>
              ))}
          </fieldset>
          <p className="m-0 text-caption text-muted-foreground">
            {t('Saving does not connect or run commands. Provider login and external service sign-in are separate.')}
          </p>
        </fieldset>
      </form>
    </Dialog>
  )
}

export function McpSettings() {
  useLanguage()
  const invoke = useSettingsInvoke(),
    on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const ws = useWorkspace()
  const models = useModelSets()
  const preferences = useAppSettings().preferences
  const defaultProvider =
    models.preferences.sets.flatMap((set) => set.steps).find((step) => step.id === models.preferences.defaultStepId)
      ?.provider ?? 'claude-code'
  const query = useQuery({
    queryKey: ['mcp-settings', hostKey],
    queryFn: () => invoke('mcp.status'),
    enabled: !scope || (scope.ready && !scope.stale),
  })
  const projects = useQuery({
    queryKey: ['mcp-projects', hostKey],
    queryFn: () => invoke('projects.list'),
    enabled: !scope || (scope.ready && !scope.stale),
  })
  const [editing, setEditing] = useState<SharedMcpConnection | 'new' | null>(null)
  const [removing, setRemoving] = useState<SharedMcpConnection | null>(null)
  const [approvedTools, setApprovedTools] = useState<string[]>([])
  const reviewId = useId()
  const [review, setReview] = useState<{
    inspection: SharedMcpInspection
    connection: SharedMcpConnection
    selection: SharedMcpSelection
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    setEditing(null)
    setReview(null)
    setRemoving(null)
    setError('')
    setBusy(false)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- this is a cancellation counter, not a DOM ref
      epoch.current++
    }
  }, [hostKey])
  const refetch = query.refetch
  useEffect(
    () =>
      on('mcp:changed', () => {
        void refetch()
      }),
    [on, refetch],
  )
  const act = async (work: () => Promise<unknown>, success?: () => void) => {
    const current = epoch.current
    setBusy(true)
    setError('')
    try {
      await work()
      if (current === epoch.current) {
        success?.()
        await query.refetch()
      }
    } catch (reason) {
      if (current === epoch.current) setError(errorText(reason))
    } finally {
      if (current === epoch.current) setBusy(false)
    }
  }
  const data = query.data
  const canAdminister = data?.canAdminister === true && (!scope || (scope.ready && !scope.stale))
  const check = (connection: SharedMcpConnection, selectedProvider?: AgentProvider, selectedAccount?: string) => {
    const provider =
      selectedProvider ?? (connection.providers.includes(defaultProvider) ? defaultProvider : connection.providers[0]!)
    const accountId = selectedAccount ?? (preferences.providerBinaries[provider]?.accountId || 'default')
    const selection: SharedMcpSelection = { provider, accountId, projectId: connection.scope.projectIds[0] ?? null }
    const current = epoch.current
    void act(async () => {
      // This records account setup only; connection/tool approval is a separate explicit review below.
      const account = data?.accounts.find((entry) => entry.provider === provider && entry.accountId === accountId)
      if (!account) await invoke('mcp.account', { provider, accountId, shareApprovals: false })
      const inspection = await invoke('mcp.check', connection.id, selection)
      if (current === epoch.current) {
        setReview({ inspection, connection, selection })
        setApprovedTools(inspection.tools.map((tool) => tool.name))
      }
    })
  }
  const save = (definition: Definition) => {
    void act(
      () => invoke('mcp.save', definition, editing !== 'new' ? editing?.id : undefined),
      () => setEditing(null),
    )
  }
  const hostName = scope?.available.find((host) => host.id === scope.primaryId)?.name ?? t('This host')
  return (
    <div className="flex flex-col gap-3">
      <SettingsGroupTitle className="m-0">{t('Connected through Ramu')}</SettingsGroupTitle>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Add a remote server no provider has yet. Ramu connects it and lets you review its tools first.')}
      </p>
      {(error || query.error || projects.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || errorText(query.error ?? projects.error)}</AlertDescription>
        </Alert>
      )}
      {data && !canAdminister && (
        <Alert>
          <AlertDescription>{t('Manage MCP connections and credentials on the host running Ramu')}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {(data?.connections.length ?? 0) > 5 && (
          <Input
            aria-label={t('Search MCP servers')}
            placeholder={t('Search MCP servers')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        <Button disabled={!canAdminister || busy} onClick={() => setEditing('new')}>
          {t('Add server')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || query.isFetching || Boolean(scope && (!scope.ready || scope.stale))}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      {!data && !query.error && <p role="status">{t('Loading…')}</p>}
      {data?.connections.length === 0 && (
        <p className="m-0 text-caption text-muted-foreground">{t('No servers connected through Ramu yet.')}</p>
      )}
      <SettingsCardList>
        {data?.connections
          .filter(({ connection }) => connection.name.toLowerCase().includes(search.toLowerCase()))
          .map(({ connection, status, reason, checkedAt, toolCount }) => (
            <SettingsCard
              key={connection.id}
              title={connection.name}
              badges={<Badge variant="secondary">{t(statusLabels[status])}</Badge>}
              meta={`${connection.providers.map(providerName).join(', ')} · ${connection.scope.hostWide ? t('All projects') : connection.scope.projectIds.map((id) => projects.data?.find((project) => project.id === id)?.name ?? id).join(', ')}`}
            >
              {reason && <p className="m-0 text-caption text-muted-foreground">{t(reason)}</p>}
              {checkedAt && (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Last checked')}: {new Date(checkedAt).toLocaleString()}{' '}
                  {toolCount !== undefined && `· ${toolCount} ${t('tools')}`}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!canAdminister || busy || !connection.enabled}
                  onClick={() => check(connection)}
                >
                  {t(status === 'connected' ? 'Check connection' : 'Connect')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canAdminister || busy}
                  onClick={() => setEditing(connection)}
                >
                  {t('Edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canAdminister || busy}
                  onClick={() =>
                    void act(async () => {
                      const { id, hostId: _host, revision: _revision, ...definition } = connection
                      await invoke('mcp.save', { ...definition, enabled: !connection.enabled }, id)
                    })
                  }
                >
                  {t(connection.enabled ? 'Disable' : 'Enable')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canAdminister || busy}
                  onClick={() => void act(() => invoke('mcp.disconnect', connection.id))}
                >
                  {t('Disconnect')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canAdminister || busy}
                  onClick={() => setRemoving(connection)}
                >
                  {t('Remove')}
                </Button>
              </div>
            </SettingsCard>
          ))}
      </SettingsCardList>
      {editing && (
        <ConnectionEditor
          key={`${hostKey}:${editing === 'new' ? 'new' : editing.id}`}
          initial={editing === 'new' ? undefined : editing}
          projects={projects.data ?? []}
          defaultProject={
            projects.data?.some((project) => project.id === ws.composing) ? (ws.composing ?? undefined) : undefined
          }
          defaultProvider={defaultProvider}
          hostName={hostName}
          busy={busy}
          error={error}
          onSave={save}
          onCancel={() => {
            if (!busy) setEditing(null)
          }}
        />
      )}
      {review && (
        <Dialog
          title={t('Review MCP access')}
          confirmLabel={t('Approve access')}
          busy={busy}
          error={error}
          confirmDisabled={!approvedTools.length}
          onConfirm={() =>
            void act(
              () =>
                invoke('mcp.approve', {
                  connectionId: review.connection.id,
                  revision: review.inspection.revision,
                  catalogRevision: review.inspection.catalogRevision,
                  provider: review.selection.provider,
                  accountId: review.selection.accountId,
                  scope: review.connection.scope,
                  tools: review.inspection.tools
                    .filter((tool) => approvedTools.includes(tool.name))
                    .map((tool) => ({
                      name: tool.name,
                      action: 'write',
                      approval: 'always',
                    })),
                }),
              () => setReview(null),
            )
          }
          onCancel={() => {
            if (!busy) setReview(null)
          }}
        >
          <p>
            {review.connection.name} · {providerName(review.selection.provider)} · {review.selection.accountId}
          </p>
          <p>{t('Connection host: {host}', { host: hostName })}</p>
          <Dropdown
            label={t('Provider')}
            value={review.selection.provider}
            options={review.connection.providers.map((provider) => ({
              value: provider,
              label: providerName(provider),
            }))}
            onChange={(provider) => {
              if (!busy) check(review.connection, provider as AgentProvider)
            }}
          />
          <Dropdown
            label={t('Provider account')}
            value={review.selection.accountId}
            options={providerAccountRows(preferences.providerBinaries, review.selection.provider).map((accountId) => ({
              value: accountId,
              label:
                accountId === 'default'
                  ? t('Default account')
                  : preferences.providerBinaries[review.selection.provider]?.accounts?.find(
                      (account) => account.id === accountId,
                    )?.name || accountId,
            }))}
            onChange={(accountId) => {
              if (!busy) check(review.connection, review.selection.provider, accountId)
            }}
          />
          <p>
            {t(
              'Review the server and tool schemas. Every invocation will still ask for approval; upstream read-only hints do not grant permission.',
            )}
          </p>
          <div className="max-h-72 overflow-auto">
            {review.inspection.tools.map((tool, index) => (
              <Field key={tool.name}>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${reviewId}-${index}`}
                    disabled={busy}
                    checked={approvedTools.includes(tool.name)}
                    onCheckedChange={(checked) =>
                      setApprovedTools((current) =>
                        checked ? [...current, tool.name] : current.filter((name) => name !== tool.name),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`${reviewId}-${index}`}>{tool.name}</FieldLabel>
                </Field>
                <details>
                  <summary>{t('Tool details')}</summary>
                  <p>{tool.description}</p>
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                </details>
              </Field>
            ))}
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title={t('Remove MCP server')}
          confirmLabel={t('Remove')}
          danger
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) setRemoving(null)
          }}
          onConfirm={() =>
            void act(
              () => invoke('mcp.remove', removing.id),
              () => setRemoving(null),
            )
          }
        >
          <p>
            {removing.name} · {hostName}
          </p>
          <p>
            {t(
              'Removing this server revokes its shared access and deletes credentials stored by Ramu. External CLI sign-ins are unchanged.',
            )}
          </p>
        </Dialog>
      )}
    </div>
  )
}
