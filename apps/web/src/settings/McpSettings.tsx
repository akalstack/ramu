import { useContext, useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentProvider, Project } from '@ramu/shared/types'
import type { SharedMcpConnection, SharedMcpInspection, SharedMcpSelection } from '@ramu/shared/mcp'
import { namesPrivateHost, serverNameFromUrl } from '@ramu/shared/mcp'
import { Globe, KeyRound, Plus, RefreshCw, SquareTerminal } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ExpandRow } from '@/components/expand-row'
import { AGENT_PROVIDERS, providerName, providerAccountRows } from '@ramu/shared/providers/providers'
import { ProviderIcon } from '../models/ProviderIcon'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, Dropdown } from '../Menu'
import { accountKey } from '@ramu/shared/identities'
import { AccountIdentityPicker, IdentityDropdown, IdentityName, useAccountIdentities } from './AccountIdentity'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { revocationNotice } from './mcpRevocation'
import { ramu } from '../ipc'
import { useWorkspace } from '../workspace/workspace'
import { useModelSets } from '../models/ModelSets'
import { useAppSettings } from './AppSettings'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsCard, SettingsCardList, SettingsSectionHead } from './cards'
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

/** A group of choices in the editor, labelled like its text fields so the form reads as one column of equal parts. */
const LEGEND = 'mb-2 text-sm leading-snug font-medium'
/** The dialog's surface matches the toggle's own pressed fill, so the chosen option gets one it can be seen on. */
const SEGMENT = 'text-muted-foreground aria-pressed:bg-fill-hover aria-pressed:text-foreground'

function ConnectionEditor({
  initial,
  projects,
  defaultProject,
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
  // A typed private address needs no opt-in; this keeps it for a public name that resolves inside the network.
  const [privateName, setPrivateName] = useState(
    first?.type === 'http' && first.allowPrivateNetwork === true && !namesPrivateHost(first.url),
  )
  const [clientId, setClientId] = useState(first?.type === 'http' ? (first.oauthClientId ?? '') : '')
  const [command, setCommand] = useState(first?.type === 'stdio' ? first.command : '')
  const [args, setArgs] = useState(first?.type === 'stdio' ? first.args.join('\n') : '')
  const [cwd, setCwd] = useState(first?.type === 'stdio' ? first.cwd : '')
  // Every agent can use a new server; narrowing it is a choice, not a first step.
  const [providers, setProviders] = useState<AgentProvider[]>(initial?.providers ?? [...AGENT_PROVIDERS])
  const [scope, setScope] = useState(
    initial?.scope ?? { projectIds: defaultProject ? [defaultProject] : [], hostWide: !defaultProject },
  )
  const [advanced, setAdvanced] = useState(!!(first?.type === 'http' && (first.oauthClientId || privateName)))
  const privateAddress = kind === 'http' && namesPrivateHost(url)
  const suggestedName = kind === 'http' ? serverNameFromUrl(url) : (command.trim().split('/').pop() ?? '')
  const live = initial?.transport
  const credentialNames = live
    ? Object.keys(live.type === 'http' ? live.headerSecretRefs : live.envSecretRefs).sort()
    : []
  const save = () =>
    onSave({
      name: name.trim() || suggestedName,
      // The service account only keys the server's stored credentials; identities choose accounts, not this label.
      serviceAccountId: initial?.serviceAccountId ?? 'public',
      enabled: initial?.enabled ?? true,
      scope,
      providers,
      transport:
        kind === 'http'
          ? {
              type: 'http',
              url,
              headerSecretRefs: live?.type === 'http' ? live.headerSecretRefs : {},
              ...(privateAddress || privateName ? { allowPrivateNetwork: true } : {}),
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
  const chip = 'flex items-center gap-1.5 text-control'
  return (
    <Dialog
      title={t(initial ? 'Edit MCP server' : 'Add MCP server')}
      confirmLabel={t(initial ? 'Save' : 'Add server')}
      onCancel={onCancel}
      onConfirm={() => form.current?.requestSubmit()}
      busy={busy}
      error={error}
      confirmDisabled={
        !(name.trim() || suggestedName) || !ready || !providers.length || (!scope.hostWide && !scope.projectIds.length)
      }
    >
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <fieldset disabled={busy} className="m-0 flex flex-col gap-4 border-0 p-0">
          {!initial && (
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={2}
              className="grid w-full grid-cols-2 gap-1.5"
              aria-label={t('Type')}
              value={[kind]}
              onValueChange={(values) => values[0] && setKind(values[0] as 'http' | 'stdio')}
            >
              <ToggleGroupItem value="http" className={`h-8 justify-center gap-1.5 px-2.5 ${SEGMENT}`}>
                <Globe size={13} aria-hidden />
                {t('Remote server')}
              </ToggleGroupItem>
              <ToggleGroupItem value="stdio" className={`h-8 justify-center gap-1.5 px-2.5 ${SEGMENT}`}>
                <SquareTerminal size={13} aria-hidden />
                {t('Local command')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {kind === 'http' ? (
            <Field>
              <FieldLabel htmlFor={`${id}-url`}>{t('Server URL')}</FieldLabel>
              <Input
                id={`${id}-url`}
                type="url"
                autoFocus={!initial}
                placeholder="https://mcp.deepwiki.com/mcp"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
              <FieldDescription>
                {privateAddress
                  ? t('A private address: {host} reaches it on your network.', { host: hostName })
                  : t('Ramu signs in to the service the first time an agent uses it, if it asks.')}
              </FieldDescription>
            </Field>
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
                  autoFocus={!initial}
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
            <FieldLabel htmlFor={`${id}-name`}>{t('Name')}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              placeholder={suggestedName || t('Name it')}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
            />
          </Field>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={LEGEND}>{t('Agents that can use it')}</legend>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              {AGENT_PROVIDERS.map((provider) => (
                <label key={provider} className={chip}>
                  <Checkbox
                    checked={providers.includes(provider)}
                    onCheckedChange={(checked) =>
                      setProviders((current) =>
                        checked ? [...current, provider] : current.filter((entry) => entry !== provider),
                      )
                    }
                  />
                  <ProviderIcon provider={provider} size={13} />
                  {providerName(provider)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={LEGEND}>{t('Projects')}</legend>
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={2}
              className="gap-1.5"
              aria-label={t('Projects')}
              value={[scope.hostWide ? 'all' : 'chosen']}
              onValueChange={(values) =>
                values[0] && setScope((current) => ({ ...current, hostWide: values[0] === 'all' }))
              }
            >
              <ToggleGroupItem value="all" className={`px-2.5 ${SEGMENT}`}>
                {t('All projects')}
              </ToggleGroupItem>
              <ToggleGroupItem value="chosen" className={`px-2.5 ${SEGMENT}`} disabled={!projects.length}>
                {t('Chosen projects')}
              </ToggleGroupItem>
            </ToggleGroup>
            {!scope.hostWide && (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {projects.map((project) => (
                  <label key={project.id} className={chip}>
                    <Checkbox
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
                    {project.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {kind === 'http' && (
            <div className="flex flex-col gap-4 border-t border-(--line) pt-3">
              <ExpandRow
                expanded={advanced}
                onToggle={() => setAdvanced((value) => !value)}
                className="-ml-1.5 w-auto self-start rounded-(--radius-s) px-1.5"
              >
                {t('Advanced')}
              </ExpandRow>
              {advanced && (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-client`}>{t('OAuth client ID')}</FieldLabel>
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
                  {!privateAddress && (
                    <label className={chip}>
                      <Checkbox checked={privateName} onCheckedChange={(checked) => setPrivateName(checked === true)} />
                      {t('Its name resolves to a private address on this host’s network')}
                    </label>
                  )}
                </>
              )}
            </div>
          )}
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
        <p className="m-0 mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <KeyRound size={13} aria-hidden className="flex-none" />
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
  // With two or more identities a server can hold an account per identity, each signed in on its own.
  const { identities, identity } = useAccountIdentities()
  const [adding, setAdding] = useState<{ connection: SharedMcpConnection; identityId: string } | null>(null)
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
    setAdding(null)
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
  /** Identities without their own account on this server yet. */
  const freeFor = (connection: SharedMcpConnection) =>
    (identities ?? []).filter(
      (entry) =>
        !data?.connections.some(
          (other) => other.connection.split?.base === connection.id && other.connection.split.identityId === entry.id,
        ),
    )
  return (
    <div className="flex flex-col gap-3">
      <SettingsSectionHead
        title={t('Connected through Ramu')}
        help={t('Add a remote server no provider has yet. Ramu connects it, and you review its tools first.')}
        action={
          <div className="flex flex-none items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('Refresh')}
              title={t('Refresh')}
              disabled={busy || query.isFetching || Boolean(scope && (!scope.ready || scope.stale))}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : undefined} />
            </Button>
            <Button size="sm" disabled={!canAdminister || busy} onClick={() => setEditing('new')}>
              <Plus size={14} />
              {t('Add server')}
            </Button>
          </div>
        }
      />
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
      {notice && (
        <p role="status" className="m-0 text-caption text-muted-foreground">
          {t(notice)}
        </p>
      )}
      {!data && !query.error && <p role="status">{t('Loading…')}</p>}
      <ListToolbar view={view} label={t('Search MCP servers')} />
      <ListCount view={view} />
      {data && view.empty !== 'ok' && (
        <div className="rounded-(--radius-m) border border-dashed border-(--line)">
          <ListEmpty
            view={view}
            none="No servers connected through Ramu yet."
            filtered="No MCP servers match your search."
          />
        </div>
      )}
      <SettingsCardList>
        {data &&
          view.paged.shown.map(({ connection, status, reason, checkedAt, toolCount }) => (
            <SettingsCard
              key={connection.id}
              title={
                <span className="inline-flex min-w-0 items-center gap-2">
                  {connection.transport.type === 'http' ? (
                    <Globe size={14} className="flex-none text-muted-foreground" aria-hidden />
                  ) : (
                    <SquareTerminal size={14} className="flex-none text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate">{connection.name}</span>
                </span>
              }
              badges={
                <>
                  <Badge variant="secondary">{t(statusLabels[status])}</Badge>
                  {(() => {
                    const own = identity(connection.split?.identityId)
                    return own ? <IdentityName identity={own} /> : null
                  })()}
                </>
              }
              meta={`${connection.providers.map(providerName).join(', ')} · ${connection.scope.hostWide ? t('All projects') : connection.scope.projectIds.map((id) => projects.data?.find((project) => project.id === id)?.name ?? id).join(', ')}`}
            >
              {reason && <p className="m-0 text-caption text-muted-foreground">{t(reason)}</p>}
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-caption text-muted-foreground">
                {AGENT_PROVIDERS.map((provider) => ({
                  provider,
                  availability: connectionAvailability(
                    connection,
                    status,
                    data.readiness,
                    provider,
                    data.providerManaged,
                  ),
                }))
                  // A provider the connection is not for has nothing to report; listing it only buries the rest.
                  .filter(
                    ({ provider, availability }) =>
                      connection.providers.includes(provider) || availability.state === 'native-only',
                  )
                  .map(({ provider, availability }) => (
                    <li
                      key={provider}
                      title={t(availability.reason)}
                      className={`inline-flex items-center gap-1.5 rounded-full bg-fill py-0.5 pr-2.5 pl-1.5 ${availability.state === 'shared' ? 'text-foreground' : ''}`}
                    >
                      <ProviderIcon provider={provider} size={13} />
                      <span>
                        {providerName(provider)} · {t(availabilityLabels[availability.state])}
                      </span>
                    </li>
                  ))}
              </ul>
              {checkedAt && (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Last checked')}: {new Date(checkedAt).toLocaleString()}{' '}
                  {toolCount !== undefined && `· ${toolCount} ${t('tools')}`}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-(--line) pt-2.5">
                {!connection.split && (
                  <AccountIdentityPicker accountKey={accountKey('mcp', connection.id)} name={connection.name} />
                )}
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
                {!connection.split && canAdminister && freeFor(connection).length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAdding({ connection, identityId: freeFor(connection)[0]!.id })}
                  >
                    {t('Add account')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
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
                  className="hover:text-bad"
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
              'Review the server and its tool schemas. Every tool call still asks for approval. Read-only hints from the server do not grant permission.',
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
      {adding && identities && (
        <Dialog
          title={t('Add a {0} account', { 0: adding.connection.name })}
          confirmLabel={t('Add account')}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) setAdding(null)
          }}
          onConfirm={() =>
            void act(
              () => invoke('mcp.splitForIdentity', adding.connection.id, adding.identityId),
              () => setAdding(null),
            )
          }
        >
          <IdentityDropdown
            identities={freeFor(adding.connection)}
            everyIdentity={false}
            caption={t('For')}
            label={t('Which identity uses it')}
            value={adding.identityId}
            onChange={(identityId) => setAdding({ ...adding, identityId })}
          />
          <p className="m-0 text-caption text-muted-foreground">
            {t(
              'It signs in on its own and its tools are approved on their own. Projects of that identity use it in place of {0}; agents still see one server.',
              { 0: adding.connection.name },
            )}
          </p>
        </Dialog>
      )}
    </div>
  )
}
