import { DragHandle } from '@/components/drag-handle'
import { InlineAction, LocalInlineAction } from '@/components/inline-action'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { KeyRound, LogIn, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { planName, type ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import type { SharedMcpAccountReadiness } from '@ramu/shared/mcp'
import { t } from '../i18n'
import { ramu } from '../ipc'
import { SettingsField } from './SettingsScope'
import { peakUsage, usageTone, type useAccountUsage } from './Usage'
import { SECONDARY_BUTTON_CLASS } from './constants'
import { timeAgo } from '../Menu'
import { readinessLine, readinessTone } from './mcpReadinessView'

/** `name` is what is shown (a label, the sign-in email, or a generic name); `label` is only a label the person gave. */
export type LoginRow = { id: string; name: string; label?: string; enabled?: boolean }

export function ProviderLoginRow({
  provider,
  row,
  position,
  state,
  accountUsage,
  signingIn,
  sortable,
  onlyOn,
  onLogin,
  onApiKey,
  onToggleAccount,
  onRename,
  onRemove,
  mcpSharing,
}: {
  provider: AgentProvider
  row: LoginRow
  position: number
  state: NonNullable<ProviderStatus['signIn']>[string] | undefined
  accountUsage: ReturnType<typeof useAccountUsage>
  signingIn: boolean
  sortable: boolean
  /** The only login left on; it cannot be turned off or removed. */
  onlyOn: boolean
  onLogin: () => void
  /** Opens API-key sign-in; absent where the provider has none or this client cannot enter credentials. */
  onApiKey?: () => void
  onToggleAccount: (enabled: boolean) => void
  onRename: (name: string) => void
  onRemove: () => void
  /** Shared MCP state for this login; absent hides it. Sharing itself is one switch for the provider. */
  mcpSharing?: {
    /** Whether the login can use the shared connections now, once known. */
    readiness?: SharedMcpAccountReadiness
    rechecking?: boolean
    onRecheck?: () => void
  }
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !sortable,
  })
  const [renaming, setRenaming] = useState(false),
    [removing, setRemoving] = useState(false)
  const peak = state?.signedIn
    ? peakUsage(
        accountUsage.filter((reading) => (reading.accountId ?? 'default') === row.id),
        provider,
      )
    : undefined
  const off = row.enabled === false
  const finishRename = (value: string) => {
    setRenaming(false)
    if (value.trim() !== (row.label ?? '')) onRename(value.trim())
  }
  return (
    <li
      ref={setNodeRef}
      className="relative flex items-center gap-2.5 min-w-0"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <DragHandle
        ref={setActivatorNodeRef}
        aria-label={t('Drag {0} to change its priority', { '0': row.name })}
        title={t('Drag to reorder')}
        disabled={!sortable}
        {...attributes}
        {...listeners}
      />
      <span className="w-[18px] flex-none text-center text-caption text-muted-foreground tabular-nums">{position}</span>
      <span className={`grow flex-1 min-w-0 text-left ${off ? 'opacity-60' : ''}`}>
        {renaming ? (
          <Input
            autoFocus
            aria-label={t('Account name')}
            placeholder={row.name}
            defaultValue={row.label ?? ''}
            maxLength={80}
            onBlur={(event) => finishRename(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = row.label ?? ''
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate">{row.name}</span>
            {row.id !== 'default' && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 flex-none text-muted-foreground"
                aria-label={t('Rename {0}', { '0': row.name })}
                title={t('Rename')}
                onClick={() => setRenaming(true)}
              >
                <Pencil size={12} />
              </Button>
            )}
          </span>
        )}
        <span className={`block small text-caption ${state?.signedIn ? 'text-brand' : 'muted text-muted-foreground'}`}>
          {!state
            ? ''
            : state.signedIn
              ? state.apiKey
                ? `${t('Signed in')} · ${t('API key')}`
                : `${t('Signed in')}${state.detail && state.detail !== row.name && provider !== 'opencode' ? ` · ${state.detail}` : ''}${state.plan ? ` · ${planName(state.plan)}` : ''}`
              : t('Not signed in')}
          {state?.signedIn && state.upgradeUrl && (
            <>
              {' · '}
              <LocalInlineAction
                onClick={() => void ramu.invoke('app.openExternal', state.upgradeUrl!).catch(() => {})}
              >
                {t('Upgrade plan')}
              </LocalInlineAction>
            </>
          )}
        </span>
        {mcpSharing?.readiness && (
          <span
            className={`block small text-caption ${readinessTone(mcpSharing.readiness.status) === 'warn' ? 'text-warn' : readinessTone(mcpSharing.readiness.status) === 'ok' ? 'text-brand' : 'muted text-muted-foreground'}`}
            title={mcpSharing.readiness.reason}
          >
            {readinessLine(mcpSharing.readiness, timeAgo)}
            {mcpSharing.onRecheck && (
              <InlineAction
                className="ml-1.5"
                disabled={mcpSharing.rechecking}
                aria-label={t('Check MCP access again for {0}', { '0': row.name })}
                onClick={mcpSharing.onRecheck}
              >
                {mcpSharing.rechecking ? t('Checking…') : t('Check again')}
              </InlineAction>
            )}
          </span>
        )}
      </span>
      {peak && (
        <span
          className={`flex-none tabular-nums small text-caption ${usageTone(peak) === 'bad' ? 'text-bad' : usageTone(peak) === 'warn' ? 'text-warn' : 'text-soft'}`}
          title={t('Highest usage window for {0}', { '0': row.name })}
        >
          {peak.status === 'limited' ? t('Limited') : `${peak.usedPercent}%`}
        </span>
      )}
      <Button variant="secondary" size="sm" className={SECONDARY_BUTTON_CLASS} disabled={signingIn} onClick={onLogin}>
        <LogIn size={14} />
        {signingIn ? t('Finish sign-in in your browser…') : state?.signedIn ? t('Switch login') : t('Login')}
      </Button>
      {onApiKey && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={`size-7 flex-none ${state?.apiKey ? 'text-brand' : 'text-muted-foreground'}`}
          aria-label={t('API key for {0}', { '0': row.name })}
          title={state?.apiKey ? t('Change or remove the API key') : t('Use an API key')}
          disabled={signingIn}
          onClick={onApiKey}
        >
          <KeyRound size={14} />
        </Button>
      )}
      <SettingsField
        path={`providerBinaries.${provider}.${row.id === 'default' ? 'defaultAccountEnabled' : 'accounts'}`}
      >
        {' '}
        <Switch
          aria-label={t('Turn account {0} on or off', { '0': row.name })}
          checked={!off}
          disabled={!off && onlyOn}
          onCheckedChange={onToggleAccount}
        />{' '}
      </SettingsField>
      {row.id !== 'default' && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 flex-none text-muted-foreground"
            aria-label={t('Remove {0}', { '0': row.name })}
            title={t('Remove')}
            disabled={!off && onlyOn}
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={14} />
          </Button>
          <AlertDialog open={removing} onOpenChange={setRemoving}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('Remove {0}?', { '0': row.name })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'It leaves the list and is no longer used. Threads still on it need another account. Its sign-in stays on this computer. Choose Save changes to apply.',
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onRemove}>{t('Remove')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </li>
  )
}
