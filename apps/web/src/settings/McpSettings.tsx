import { useContext, useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentProvider, Project } from '@ramu/shared/types'
import type { SharedMcpConnection, SharedMcpInspection, SharedMcpSelection } from '@ramu/shared/mcp'
import { AGENT_PROVIDERS, providerName, providerAccountRows } from '@ramu/shared/providers/providers'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dialog, Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { revocationNotice } from './mcpRevocation'
import { ramu } from '../ipc'
import { useWorkspace } from '../workspace/workspace'
import { useModelSets } from '../models/ModelSets'
import { useAppSettings } from './AppSettings'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList } from './cards'
import { ListCount, ListEmpty, ListToolbar, useListView } from './ListView'
import { availabilityLabels, connectionAvailability } from './mcpAvailability'

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

/** For a sign-in opened on another device than the host: the redirect fails to load there, and its address finishes it. */
function PasteSignInAddress({ onSubmit }: { onSubmit(address: string): void }) {
  const id = useId()
  const [address, setAddress] = useState('')
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('Signed in on another device? Paste the address the page ended on')}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="http://127.0.0.1:…/callback?code=…"
          autoComplete="off"
        />
        <Button
          size="sm"
          disabled={!address.trim()}
          onClick={() => {
            onSubmit(address)
            setAddress('')
          }}
        >
          {t('Finish sign-in')}
        </Button>
      </div>
    </Field>
  )
}

function CredentialFields({
  names,
  kind,
  busy,
  onSet,
  onRemove,
}: {
  names: string[]
  kind: 'header' | 'env'
  busy: boolean
  onSet(name: string, value: string): void
  onRemove(name: string): void
}) {
  const id = useId()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const valid = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name) && value.length > 0
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend>{t(kind === 'header' ? 'Request headers (write-only)' : 'Environment secrets (write-only)')}</legend>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Values are stored on this host and are never shown again. Replacing one asks for approval again.')}
      </p>
      {names.map((entry) => (
        <div key={entry} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-caption">
            {entry === 'mcp-oauth' ? t('OAuth sign-in') : entry}
          </span>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(entry)}>
            {t('Remove')}
          </Button>
        </div>
      ))}
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>{t(kind === 'header' ? 'Header name' : 'Variable name')}</FieldLabel>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'header' ? 'Authorization' : 'SERVICE_API_KEY'}
          autoComplete="off"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-value`}>{t('Value')}</FieldLabel>
        <Input
          id={`${id}-value`}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <div>
        <Button
          type="button"
          size="sm"
          disabled={busy || !valid}
          onClick={() => {
            onSet(name, value)
            setName('')
            setValue('')
          }}
        >
          {t(names.includes(name) ? 'Replace credential' : 'Save credential')}
        </Button>
      </div>
    </fieldset>
  )
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
  onSetCredential,
  onRemoveCredential,
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
  onSetCredential(name: string, value: string): void
  onRemoveCredential(name: string): void
}) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const first = initial?.transport
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<'http' | 'stdio'>(first?.type ?? 'http')
  const [url, setUrl] = useState(first?.type === 'http' ? first.url : '')
  const [privateNetwork, setPrivateNetwork] = useState(first?.type === 'http' && first.allowPrivateNetwork === true)
  const [clientId, setClientId] = useState(first?.type === 'http' ? (first.oauthClientId ?? '') : '')
  const [command, setCommand] = useState(first?.type === 'stdio' ? first.command : '')
  const [args, setArgs] = useState(first?.type === 'stdio' ? first.args.join('\n') : '')
  const [cwd, setCwd] = useState(first?.type === 'stdio' ? first.cwd : '')
  const [account, setAccount] = useState(initial?.serviceAccountId ?? 'public')
  const [providers, setProviders] = useState<AgentProvider[]>(initial?.providers ?? [defaultProvider])
  const [scope, setScope] = useState(
    initial?.scope ?? { projectIds: defaultProject ? [defaultProject] : [], hostWide: false },
  )
  const live = initial?.transport
  const credentialNames = live
    ? Object.keys(live.type === 'http' ? live.headerSecretRefs : live.envSecretRefs).sort()
    : []
  const save = () =>
    onSave({
      name,
      serviceAccountId: account.trim() || 'public',
      enabled: initial?.enabled ?? true,
      scope,
      providers,
      transport:
        kind === 'http'
          ? {
              type: 'http',
              url,
              headerSecretRefs: live?.type === 'http' ? live.headerSecretRefs : {},
              ...(privateNetwork ? { allowPrivateNetwork: true } : {}),
              ...(clientId.trim() ? { oauthClientId: clientId.trim() } : {}),
            }
          : {
              type: 'stdio',
              command: command.trim(),
              args: args.split('\n').filter((line) => line.length > 0),
              cwd: cwd.trim(),
              envSecretRefs: live?.type === 'stdio' ? live.envSecretRefs : {},
            },
    })
  const ready = kind === 'http' ? Boolean(url.trim()) : Boolean(command.trim() && cwd.trim())
  return (
    <Dialog
      title={t(initial ? 'Edit MCP server' : 'Add MCP server')}
      confirmLabel={t('Save')}
      onCancel={onCancel}
      onConfirm={() => form.current?.requestSubmit()}
      busy={busy}
      error={error}
      confirmDisabled={!name.trim() || !ready || !providers.length || (!scope.hostWide && !scope.projectIds.length)}
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
          <fieldset className="m-0 flex gap-4 border-0 p-0">
            <legend>{t('Type')}</legend>
            {(['http', 'stdio'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === value}
                  disabled={Boolean(initial)}
                  onChange={() => setKind(value)}
                />
                {t(value === 'http' ? 'Remote server' : 'Local command')}
              </label>
            ))}
          </fieldset>
          {kind === 'http' ? (
            <>
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
              <Field>
                <FieldLabel htmlFor={`${id}-client`}>{t('OAuth client ID (optional)')}</FieldLabel>
                <Input
                  id={`${id}-client`}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  maxLength={500}
                  autoComplete="off"
                />
                <FieldDescription>
                  {t(
                    'Only for servers that do not register apps automatically. Use the ID the service issued for Ramu.',
                  )}
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-private`}
                  checked={privateNetwork}
                  onCheckedChange={(checked) => setPrivateNetwork(checked === true)}
                />
                <FieldLabel htmlFor={`${id}-private`}>
                  {t('This server is on a private network. Allow the host to reach private addresses.')}
                </FieldLabel>
              </Field>
            </>
          ) : (
            <>
              <Alert>
                <AlertDescription>
                  {t(
                    'A local command runs on this host with your user’s files and processes. Ramu does not sandbox it, and saving never starts it.',
                  )}
                </AlertDescription>
              </Alert>
              <Field>
                <FieldLabel htmlFor={`${id}-command`}>{t('Executable path')}</FieldLabel>
                <Input
                  id={`${id}-command`}
                  placeholder="/usr/local/bin/my-mcp-server"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-args`}>{t('Arguments, one per line')}</FieldLabel>
                <Textarea
                  id={`${id}-args`}
                  rows={3}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-cwd`}>{t('Working folder')}</FieldLabel>
                <Input
                  id={`${id}-cwd`}
                  placeholder="/path/to/project"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  required
                />
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor={`${id}-account`}>{t('Service account')}</FieldLabel>
            <Input
              id={`${id}-account`}
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              maxLength={200}
            />
            <p className="m-0 text-caption text-muted-foreground">
              {t(
                'A label for the external service account this connection uses. Changing it removes stored credentials so the new account signs in with its own.',
              )}
            </p>
          </Field>
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
      {initial ? (
        <CredentialFields
          names={credentialNames}
          kind={kind === 'http' ? 'header' : 'env'}
          busy={busy}
          onSet={onSetCredential}
          onRemove={onRemoveCredential}
        />
      ) : (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Save the server first, then add its credentials here.')}
        </p>
      )}
    </Dialog>
  )
}

export function McpSettings() {
  useLanguage()
  const invoke = useSettingsInvoke(),
    on = useSettingsEvents()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const viewOnly = scope?.targets?.some((target) => target.viewOnly) ?? false
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
  const [notice, setNotice] = useState<string | null>(null)
  const view = useListView(query.data?.connections ?? [], {
    text: ({ connection }) => `${connection.name} ${connection.providers.map(providerName).join(' ')}`,
    size: 20,
  })
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    setEditing(null)
    setReview(null)
    setRemoving(null)
    setSigningIn(null)
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
        setSigningIn(null)
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
  const canAdminister = data?.canAdminister === true && !viewOnly && (!scope || (scope.ready && !scope.stale))
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
      {notice && (
        <p role="status" className="m-0 text-caption text-muted-foreground">
          {t(notice)}
        </p>
      )}
      {!data && !query.error && <p role="status">{t('Loading…')}</p>}
      <ListToolbar view={view} label={t('Search MCP servers')} />
      <ListCount view={view} />
      {data && (
        <ListEmpty
          view={view}
          none="No servers connected through Ramu yet."
          filtered="No MCP servers match your search."
        />
      )}
      <SettingsCardList>
        {data &&
          view.paged.shown.map(({ connection, status, reason, checkedAt, toolCount }) => (
            <SettingsCard
              key={connection.id}
              title={connection.name}
              badges={<Badge variant="secondary">{t(statusLabels[status])}</Badge>}
              meta={`${connection.providers.map(providerName).join(', ')} · ${connection.scope.hostWide ? t('All projects') : connection.scope.projectIds.map((id) => projects.data?.find((project) => project.id === id)?.name ?? id).join(', ')}`}
            >
              {reason && <p className="m-0 text-caption text-muted-foreground">{t(reason)}</p>}
              <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-caption text-muted-foreground">
                {AGENT_PROVIDERS.map((provider) => {
                  const availability = connectionAvailability(
                    connection,
                    status,
                    data.readiness,
                    provider,
                    data.providerManaged,
                  )
                  return (
                    <li key={provider} title={t(availability.reason)}>
                      {providerName(provider)}: {t(availabilityLabels[availability.state])}
                    </li>
                  )
                })}
              </ul>
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
                  {t(
                    status === 'connected'
                      ? 'Check connection'
                      : status === 'failed' || status === 'sign-in-required' || status === 'insufficient-permission'
                        ? 'Reconnect'
                        : 'Connect',
                  )}
                </Button>
                {connection.transport.type === 'http' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canAdminister || busy || !connection.enabled || signingIn === connection.id}
                    onClick={() =>
                      void act(async () => {
                        const started = await invoke('mcp.signIn', connection.id)
                        if (started) {
                          setSigningIn(connection.id)
                          await ramu.invoke('app.openExternal', started.url)
                        }
                      })
                    }
                  >
                    {t(
                      connection.transport.headerSecretRefs['mcp-oauth'] || status === 'sign-in-required'
                        ? 'Sign in again'
                        : 'Sign in',
                    )}
                  </Button>
                )}
                {signingIn === connection.id && (
                  <>
                    <span role="status" className="text-caption text-muted-foreground">
                      {t('Waiting for sign-in in your browser…')}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSigningIn(null)
                        void invoke('mcp.cancelSignIn', connection.id)
                      }}
                    >
                      {t('Cancel sign-in')}
                    </Button>
                    <PasteSignInAddress
                      onSubmit={(address) =>
                        void act(async () => {
                          if (await invoke('mcp.completeSignIn', connection.id, address)) setSigningIn(null)
                          else
                            throw new Error(
                              t('That address did not finish the sign-in. Copy it again after the page fails to load.'),
                            )
                        })
                      }
                    />
                  </>
                )}
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
                  onClick={() => {
                    setNotice(null)
                    void act(async () => {
                      const text = revocationNotice(await invoke('mcp.disconnect', connection.id))
                      if (text) setNotice(text)
                    })
                  }}
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
        {view.paged.more}
      </SettingsCardList>
      {editing && (
        <ConnectionEditor
          key={`${hostKey}:${editing === 'new' ? 'new' : editing.id}`}
          initial={
            editing === 'new'
              ? undefined
              : (data?.connections.find((entry) => entry.connection.id === editing.id)?.connection ?? editing)
          }
          onSetCredential={(name, value) =>
            editing !== 'new' && void act(() => invoke('mcp.setCredential', editing.id, name, value))
          }
          onRemoveCredential={(name) =>
            editing !== 'new' && void act(() => invoke('mcp.removeCredential', editing.id, name))
          }
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
                      action: 'write' as const,
                      approval: 'always' as const,
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
