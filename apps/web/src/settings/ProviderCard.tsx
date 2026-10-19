import { SettingsRow } from '@/components/settings-row'
import { Card } from '@/components/ui/card'
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
import { t } from '../i18n'
import { ProviderIcon } from '../models/ProviderIcon'
import { SettingsField } from './SettingsScope'
import type { useAccountUsage } from './Usage'
import { SECONDARY_BUTTON_CLASS } from './constants'
import { PROVIDER_ACTIONS_CLASS, ProviderAddAccount, type ProviderPrefs } from './ProviderAccountControls'
import { ProviderLoginRow } from './ProviderLoginRow'

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
  onToggleAccount,
  onReorder,
  onRename,
  onRemove,
  onAddAccount,
  onUpdate,
  onBrowse,
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
  onToggleAccount: (id: string, enabled: boolean) => void
  /** Account IDs in the new priority order; the first is used first. */
  onReorder: (ids: string[]) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onAddAccount: () => void
  onUpdate: () => void
  onBrowse: (key: 'binary' | 'harness') => void
}) {
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
    canUpdate = !((provider === 'codex' || provider === 'antigravity') && preferences?.binary?.trim())
  return (
    <Card
      role="region"
      className={`gap-3 overflow-visible ring-0 text-body provider-settings-card [&_header]:flex [&_header]:items-center [&_header]:gap-2.5 [border:1px_solid_transparent] rounded-(--radius-row) p-4 min-w-0 bg-fill`}
      aria-label={t('{0} settings', { '0': providerName(provider) })}
    >
      <header>
        <ProviderIcon provider={provider} size={22} />
        <strong>{providerName(provider)}</strong>
        <span className="muted text-muted-foreground small text-caption">{status?.version ?? ''}</span>
        <span className="grow flex-1 min-w-0 text-left" />
        <span
          className={`small text-caption ${status?.updateAvailable ? 'provider-update-label text-brand' : 'muted text-muted-foreground'}`}
        >
          {!enabled
            ? t('Off')
            : !status
              ? t('Detecting…')
              : !status.installed
                ? t(provider === 'antigravity' ? 'Runtime not found' : 'CLI not found')
                : status.updateAvailable
                  ? t('Update available')
                  : t('Installed')}
        </span>
        <SettingsField path={`providerBinaries.${provider}.enabled`}>
          {' '}
          <Switch
            aria-label={t('Turn {0} on or off', { '0': providerName(provider) })}
            checked={enabled}
            disabled={enabled && lastEnabled}
            onCheckedChange={(on) => onChange({ enabled: on })}
          />{' '}
        </SettingsField>
      </header>
      {!enabled && (
        <p className="muted text-muted-foreground small text-caption">
          {t('Hidden from model pickers and never started. Turn it on to use it again.')}
        </p>
      )}
      {enabled && (
        <>
          {status?.installed && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <SettingsField path={`providerBinaries.${provider}.accountOrder`}>
                  <ul
                    className="grid gap-1.5 m-0 p-0 list-none"
                    aria-label={t('{0} logins', { '0': providerName(provider) })}
                  >
                    {order.map((id, index) => {
                      const email = status.signIn?.[id]?.email,
                        shown = accountDisplayName(config, provider, id, email),
                        account = preferences?.accounts?.find((entry) => entry.id === id)
                      return (
                        <ProviderLoginRow
                          key={id}
                          provider={provider}
                          row={{
                            id,
                            name:
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
                                  : shown.name,
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
                          onToggleAccount={(on) => onToggleAccount(id, on)}
                          onRename={(name) => onRename(id, name)}
                          onRemove={() => onRemove(id)}
                        />
                      )
                    })}
                  </ul>
                </SettingsField>
              </SortableContext>
            </DndContext>
          )}
          {accounts && <ProviderAddAccount preferences={preferences} onAdd={onAddAccount} />}
          {accounts && (
            <p className="muted text-muted-foreground small text-caption">
              {t(
                'New threads use the top account; existing threads keep theirs. When the account a thread is using reaches its limit, it continues on the next enabled account below it before switching models.',
              )}
            </p>
          )}
          <div className={PROVIDER_ACTIONS_CLASS}>
            {canUpdate ? (
              <Button
                variant="secondary"
                className={SECONDARY_BUTTON_CLASS}
                disabled={(!status?.installed && provider !== 'antigravity') || updating !== null || status?.updating}
                onClick={onUpdate}
              >
                <RefreshCw
                  size={14}
                  className={updating === provider ? 'spin [animation:spin_0.9s_linear_infinite]' : ''}
                />
                {provider === 'antigravity'
                  ? updating === provider
                    ? t(status?.installed ? 'Updating…' : 'Installing…')
                    : t(status?.installed ? 'Update runtime' : 'Install runtime')
                  : updating === provider
                    ? t('Updating…')
                    : t('Update CLI')}
              </Button>
            ) : (
              <a href={status?.downloadUrl ?? status?.docsUrl} target="_blank" rel="noreferrer">
                {t('Provider website ↗')}
              </a>
            )}
          </div>
          {provider === 'cursor' && (
            <SettingsRow setting={`providerBinaries.${provider}.usageKeychain`} className="settings-toggle">
              <span className="small text-caption">
                {t('Show plan usage')}
                <span className="muted text-muted-foreground block small text-caption">
                  {t(
                    'Reads your Cursor login from the macOS Keychain to show monthly usage. macOS asks for permission.',
                  )}
                </span>
              </span>
              <Switch
                aria-label={t('Show Cursor plan usage')}
                checked={preferences?.usageKeychain ?? false}
                onCheckedChange={(usageKeychain) => onChange({ usageKeychain })}
              />
            </SettingsRow>
          )}
          {canUpdate && (
            <SettingsRow
              setting={`providerBinaries.${provider}.autoUpdate`}
              className="settings-toggle [&:not(:has(+_.settings-row))]:mb-0"
            >
              <span className="small text-caption">
                {t(provider === 'antigravity' ? 'Auto-update runtime' : 'Auto-update CLI')}
                <span className="muted text-muted-foreground block block small text-caption">
                  {t('Updates apply to new provider processes. Running threads stay connected.')}
                </span>
              </span>
              <Switch
                aria-label={t(provider === 'antigravity' ? 'Auto-update {0} runtime' : 'Auto-update {0} CLI', {
                  '0': providerName(provider),
                })}
                checked={preferences?.autoUpdate ?? false}
                onCheckedChange={(autoUpdate) => onChange({ autoUpdate })}
              />
            </SettingsRow>
          )}
          {status?.latestVersion && status.updateAvailable && (
            <p className="muted text-muted-foreground small text-caption">
              {t('Available version: {0}', { '0': status.latestVersion })}
            </p>
          )}
          {[status?.versionError, status?.error, status?.updateError].filter(Boolean).map((message) => (
            <p key={message} className="error text-bad small text-caption" role="alert">
              {message}
            </p>
          ))}
          <Collapsible>
            <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="small text-caption" />}>
              {t('Advanced')}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <label
                className="provider-binary-label block text-caption m-[12px_0_6px]"
                htmlFor={`provider-${provider}`}
              >
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
        </>
      )}
    </Card>
  )
}
