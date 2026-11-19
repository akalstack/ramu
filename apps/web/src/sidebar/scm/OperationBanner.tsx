import { Sparkles } from 'lucide-react'
import type { GitStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import { PRIMARY_BUTTON } from './classes'

/** Banner for a rebase or merge in progress, with Resolve with AI, Continue and Abort. */
export function OperationBanner({
  operation,
  conflictCount,
  busy,
  resolving,
  onResolveWithAi,
  onContinue,
  onAbort,
}: {
  operation: NonNullable<GitStatus['operation']>
  conflictCount: number
  busy: boolean
  resolving: boolean
  onResolveWithAi: () => void
  onContinue: () => void
  onAbort: () => void
}) {
  return (
    <div
      className="scm-operation flex flex-col gap-2 p-2.5 mb-2 [border:1px_solid_color-mix(in_srgb,_var(--warn)_40%,_transparent)] rounded-(--radius-s) [background:var(--warn-wash)] text-soft text-control leading-[18px]"
      role="status"
    >
      <span>
        {operation === 'rebase' ? t('Rebase in progress.') : t('Merge in progress.')}{' '}
        {conflictCount
          ? t('Resolve {0} conflicted {1}, stage them, then continue.', {
              '0': conflictCount,
              '1': conflictCount === 1 ? 'file' : 'files',
            })
          : t('Conflicts are resolved and staged.')}
      </span>
      <div className="scm-operation-actions [&_button]:flex-1 [&_button]:justify-center [&_button]:h-[26px] [&_button]:whitespace-nowrap [&_button:first-child:not(.primary)]:[flex:1_1_100%] flex flex-wrap gap-1.5">
        {!!conflictCount && (
          <Button
            variant="secondary"
            size="sm"
            className="bg-fill hover:bg-fill-hover small text-caption"
            disabled={busy || resolving}
            onClick={onResolveWithAi}
          >
            <Sparkles size={13} />
            {resolving ? t('Starting…') : t('Resolve with AI')}
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          className={`${PRIMARY_BUTTON} small text-caption`}
          disabled={busy || !!conflictCount}
          onClick={onContinue}
        >
          {t('Continue')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="bg-fill hover:bg-fill-hover small text-caption"
          disabled={busy}
          onClick={onAbort}
        >
          {operation === 'rebase' ? t('Abort rebase') : t('Abort merge')}
        </Button>
      </div>
    </div>
  )
}
