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
import { GripVertical, LogIn, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import { t } from '../i18n'
import { SettingsField } from './SettingsScope'
import { peakUsage, usageTone, type useAccountUsage } from './Usage'
import { SECONDARY_BUTTON_CLASS } from './constants'

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
  onToggleAccount,
  onRename,
  onRemove,
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
  onToggleAccount: (enabled: boolean) => void
  onRename: (name: string) => void
  onRemove: () => void
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
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="inline-grid place-items-center w-[18px] h-[22px] flex-none text-muted-foreground cursor-grab touch-none rounded-(--radius-xs) hover:text-foreground hover:bg-hover active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
        aria-label={t('Drag {0} to change its priority', { '0': row.name })}
        title={t('Drag to reorder')}
        disabled={!sortable}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
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
              ? `${t('Signed in')}${state.detail && state.detail !== row.name && provider !== 'opencode' ? ` · ${state.detail}` : ''}`
              : t('Not signed in')}
        </span>
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
