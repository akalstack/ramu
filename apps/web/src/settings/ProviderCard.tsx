import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FolderOpen, RefreshCw } from 'lucide-react'
import {
  accountDisplayName,
  providerAccountRows,
  providerName,
  supportsProviderAccounts,
  type ProviderStatus,
} from '@ramu/shared/providers/providers'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { AgentProvider } from '@ramu/shared/types'
import { useState, type ReactNode } from 'react'
import type { SharedMcpAccountReadiness } from '@ramu/shared/mcp'
import { t } from '../i18n'
import { ProviderIcon } from '../models/ProviderIcon'
import { SettingsField } from './SettingsScope'
import type { useAccountUsage } from './Usage'
import { SECONDARY_BUTTON_CLASS } from './constants'
import { ProviderAddAccount, type ProviderPrefs } from './ProviderAccountControls'
import { ProviderLoginRow } from './ProviderLoginRow'
import { ProviderCompatibility } from './ProviderCompatibility'
import { compatibilityPlan } from './compatibilityPlan'

const BROWSE_BUTTON_CLASS = `${SECONDARY_BUTTON_CLASS} icon p-0 size-(--action-size) flex-none justify-center`

export function ProviderCard({
  provider,
  status,
  preferences,
  enabled,
  lastEnabled,
  accountUsage,
  signingIn,
  updating,
  onChange,
  onLogin,
  onApiKey,
  onToggleAccount,
  onReorder,
  onRename,
  onRemove,
  onAddAccount,
  mcpSharing,
  onMcpSharing,
  mcpReadiness,
  mcpRechecking,
  onMcpRecheck,
  onUpdate,
  onBrowse,
  models,
  stale = false,
  onCheckAgain,
  onUpdateRamu,
}: {
  provider: AgentProvider
  status: ProviderStatus | undefined
  preferences: ProviderPrefs | undefined
  enabled: boolean
  // The only enabled provider cannot be turned off.
  lastEnabled: boolean
  accountUsage: ReturnType<typeof useAccountUsage>
  signingIn: boolean
  // Provider currently being updated; any update disables every update button.
  updating: AgentProvider | null
  onChange: (patch: Partial<ProviderPrefs>) => void
  onLogin: (accountId: string) => void
  /** API-key sign-in for one login, with the name it is shown by; absent hides the control. */
  onApiKey?: (accountId: string, name: string) => void
  onToggleAccount: (id: string, enabled: boolean) => void
  /** Account IDs in the new priority order; the first is used first. */
  onReorder: (ids: string[]) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onAddAccount: () => void
  /** Whether an account shares approved Shared MCP connections; undefined hides the control (not the host's administrator). */
  mcpSharing?: (id: string) => boolean | undefined
  /** Turns sharing on or off for every login of the provider at once. */
  onMcpSharing?: (ids: string[], on: boolean) => void
  /** Readiness of each login for the shared connections, and the check-again action. */
  mcpReadiness?: (id: string) => SharedMcpAccountReadiness | undefined
  mcpRechecking?: (id: string) => boolean
  onMcpRecheck?: (id: string) => void
  onUpdate: () => void
  onBrowse: (key: 'binary' | 'harness') => void
  /** The control for which of this provider's models are listed. */
  models?: ReactNode
  /** The host could not be reached; the status is its last known result. */
  stale?: boolean
  onCheckAgain: () => void
  onUpdateRamu?: () => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const accounts = supportsProviderAccounts(provider),
    config = { [provider]: preferences ?? { binary: '' } },
    order = accounts ? providerAccountRows(config, provider) : ['default'],
    sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    ),
    drop = (event: DragEndEvent) => {
      const from = order.indexOf(String(event.active.id)),
        to = order.indexOf(String(event.over?.id))
      if (from >= 0 && to >= 0 && from !== to) onReorder(arrayMove(order, from, to))
    },
    on = (id: string) =>
      id === 'default'
        ? preferences?.defaultAccountEnabled !== false
        : preferences?.accounts?.find((a) => a.id === id)?.enabled !== false,
    onCount = order.filter(on).length,
    canUpdate = !((provider === 'codex' || provider === 'antigravity') && preferences?.binary?.trim()),
    plan = compatibilityPlan(status, { customBinary: !!preferences?.binary?.trim(), canUpdate })
  const statusText = !enabled
    ? t('Off. Hidden from model pickers and never started.')
    : !status
      ? t('Detecting…')
      : !status.installed
        ? t(provider === 'antigravity' ? 'Runtime not found' : 'CLI not found')
        : status.updateAvailable
          ? t('Update available')
          : t('Installed')
  return (
    <section
      role="region"
      className="provider-settings-card min-w-0 text-body"
      aria-label={t('{0} settings', { '0': providerName(provider) })}
    >
      <SettingsRow className="py-3">
        <span className="flex min-w-0 items-center gap-3">
          <ProviderIcon provider={provider} size={24} />
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              <strong className="text-control">{providerName(provider)}</strong>
              {enabled && status?.version && (
                <span className="text-caption text-muted-foreground">{status.version}</span>
              )}
            </span>
            <span
              className={`block text-caption ${enabled && status?.updateAvailable ? 'provider-update-label text-brand' : 'text-muted-foreground'}`}
            >
              {statusText}
            </span>
          </span>
        </span>
        <SettingsField path={`providerBinaries.${provider}.enabled`}>
          <Switch
            aria-label={t('Turn {0} on or off', { '0': providerName(provider) })}
            checked={enabled}
            disabled={enabled && lastEnabled}
            onCheckedChange={(on) => onChange({ enabled: on })}
          />
        </SettingsField>
      </SettingsRow>
      {enabled && status?.installed && (
        <SettingsRow className="settings-stack gap-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <SettingsField path={`providerBinaries.${provider}.accountOrder`}>
                <ul
                  className="m-0 grid list-none gap-1.5 p-0"
                  aria-label={t('{0} logins', { '0': providerName(provider) })}
                >
                  {order.map((id, index) => {
                    const email = status.signIn?.[id]?.email,
                      shown = accountDisplayName(config, provider, id, email),
                      account = preferences?.accounts?.find((entry) => entry.id === id)
                    const name =
                      shown.fallback === 'default'
                        ? t(
                            accounts
                              ? provider === 'antigravity'
                                ? 'Default account'
                                : 'Default CLI account'
                              : 'CLI login',
                          )
                        : shown.fallback === 'numbered'
                          ? t('Account {0}', { '0': shown.number })
                          : shown.name
                    return (
                      <ProviderLoginRow
                        key={id}
                        provider={provider}
                        row={{
                          id,
                          name,
                          label: account?.name,
                          enabled: account ? account.enabled : preferences?.defaultAccountEnabled,
                        }}
                        position={index + 1}
                        state={status.signIn?.[id]}
                        accountUsage={accountUsage}
                        signingIn={signingIn}
                        sortable={order.length > 1}
                        onlyOn={onCount <= 1 && on(id)}
                        onLogin={() => onLogin(id)}
                        onApiKey={onApiKey ? () => onApiKey(id, name) : undefined}
                        onToggleAccount={(on) => onToggleAccount(id, on)}
                        onRename={(name) => onRename(id, name)}
                        onRemove={() => onRemove(id)}
                        mcpSharing={
                          mcpSharing && accounts
                            ? {
                                readiness: mcpReadiness?.(id),
                                rechecking: mcpRechecking?.(id),
                                onRecheck: onMcpRecheck ? () => onMcpRecheck(id) : undefined,
                              }
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              </SettingsField>
            </SortableContext>
          </DndContext>
          {accounts && (
            <div className="flex flex-wrap items-center gap-3">
              <ProviderAddAccount preferences={preferences} onAdd={onAddAccount} />
              <span className="min-w-0 flex-1 text-caption text-muted-foreground">
                {t(
                  'New threads use the top login. When it reaches its limit, a thread moves to the next one before switching models.',
                )}
              </span>
            </div>
          )}
        </SettingsRow>
      )}
      {enabled && accounts && mcpSharing && order.length > 1 && (
        <SettingsRow>
          <SettingsLabel
            title={t('Share MCP approvals between logins')}
            help={
              order.every((id) => mcpSharing(id) === true) || !order.some((id) => mcpSharing(id) === true)
                ? t('Switching logins at a limit keeps your approved MCP connections, with no new approval.')
                : t('On for {0} of {1} logins. Turn on to share between all of them.', {
                    0: order.filter((id) => mcpSharing(id) === true).length,
                    1: order.length,
                  })
            }
          />
          <Switch
            aria-label={t('Share MCP approvals between {0} logins', { 0: providerName(provider) })}
            checked={order.every((id) => mcpSharing(id) === true)}
            onCheckedChange={(on) => onMcpSharing?.(order, on)}
          />
        </SettingsRow>
      )}
      {enabled &&
        (canUpdate ? (
          <SettingsRow setting={`providerBinaries.${provider}.autoUpdate`}>
            <SettingsLabel
              title={t(provider === 'antigravity' ? 'Auto-update runtime' : 'Auto-update CLI')}
              help={t('Applies to new threads. Running threads stay connected.')}
            />
            <span className="flex flex-none items-center gap-2.5">
              {((status?.updateAvailable && status.updateCompatibility?.status !== 'incompatible') ||
                updating === provider ||
                (provider === 'antigravity' && !status?.installed)) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={updating !== null || status?.updating}
                  onClick={onUpdate}
                >
                  <RefreshCw
                    size={14}
                    className={updating === provider ? 'spin [animation:spin_0.9s_linear_infinite]' : ''}
                  />
                  {updating === provider
                    ? t(status?.installed ? 'Updating…' : 'Installing…')
                    : !status?.installed
                      ? t('Install runtime')
                      : status.latestVersion
                        ? t('Update to {0}', { '0': status.latestVersion })
                        : t('Update now')}
                </Button>
              )}
              <Switch
                aria-label={t(provider === 'antigravity' ? 'Auto-update {0} runtime' : 'Auto-update {0} CLI', {
                  '0': providerName(provider),
                })}
                checked={preferences?.autoUpdate ?? false}
                onCheckedChange={(autoUpdate) => onChange({ autoUpdate })}
              />
            </span>
          </SettingsRow>
        ) : (
          <SettingsRow>
            <SettingsLabel title={t('Updates')} help={t('This runtime updates itself outside Ramu.')} />
            <a className="text-control" href={status?.downloadUrl ?? status?.docsUrl} target="_blank" rel="noreferrer">
              {t('Provider website ↗')}
            </a>
          </SettingsRow>
        ))}
      {enabled && models}
      {enabled && status?.compatibility && status.installed && (
        <SettingsRow className="settings-stack">
          <ProviderCompatibility
            status={status}
            plan={plan}
            stale={stale}
            busy={updating !== null || !!status.updating}
            onUpdate={onUpdate}
            onUpdateRamu={onUpdateRamu}
            onCheckAgain={onCheckAgain}
            onChangePath={() => {
              setAdvanced(true)
              requestAnimationFrame(() => document.getElementById(`provider-${provider}`)?.focus())
            }}
          />
        </SettingsRow>
      )}
      {enabled &&
        [status?.versionError, status?.error, status?.updateError].filter(Boolean).map((message) => (
          <SettingsRow key={message} className="settings-stack">
            <p className="error m-0 text-bad small text-caption" role="alert">
              {message}
            </p>
          </SettingsRow>
        ))}
      {enabled && (
        <Collapsible
          open={advanced}
          onOpenChange={setAdvanced}
          render={<SettingsRow className="settings-stack gap-0" />}
        >
          <div className="flex items-center justify-between gap-6">
            <SettingsLabel
              title={t('Advanced')}
              help={t(provider === 'antigravity' ? 'Runtime and helper paths.' : 'Use a specific executable.')}
            />
            <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
              {advanced ? t('Hide') : t('Show')}
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="grid gap-2 pt-3">
            <label className="provider-binary-label block text-caption" htmlFor={`provider-${provider}`}>
              {t(provider === 'antigravity' ? 'Runtime path' : 'Binary path')}
            </label>
            <div className="provider-binary-input">
              <SettingsField path={`providerBinaries.${provider}.binary`}>
                {' '}
                <Input
                  id={`provider-${provider}`}
                  maxLength={4096}
                  placeholder={t('Automatic detection')}
                  value={preferences?.binary ?? ''}
                  onChange={(event) => onChange({ binary: event.target.value })}
                />{' '}
              </SettingsField>
              <Button
                variant="secondary"
                size="icon-sm"
                className={BROWSE_BUTTON_CLASS}
                aria-label={t(provider === 'antigravity' ? 'Browse {0} runtime' : 'Browse {0} binary', {
                  '0': providerName(provider),
                })}
                onClick={() => onBrowse('binary')}
              >
                <FolderOpen size={16} />
              </Button>
            </div>
            {status && (
              <p className="muted text-muted-foreground small text-caption">
                <code>{status.binary}</code>
              </p>
            )}
            {provider === 'antigravity' && (
              <>
                <label htmlFor="provider-harness">{t('Harness helper path')}</label>
                <div className="provider-binary-input">
                  <SettingsField path={`providerBinaries.${provider}.harness`}>
                    {' '}
                    <Input
                      id="provider-harness"
                      value={preferences?.harness ?? ''}
                      onChange={(event) => onChange({ harness: event.target.value })}
                    />{' '}
                  </SettingsField>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className={BROWSE_BUTTON_CLASS}
                    aria-label={t('Browse Antigravity harness helper')}
                    onClick={() => onBrowse('harness')}
                  >
                    <FolderOpen size={16} />
                  </Button>
                </div>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}
