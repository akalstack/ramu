import { Button } from '@/components/desktop-button'
import { incompatibleText } from '@ramu/shared/providers/compatibilityPlan'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import { t } from '../i18n'
import { SECONDARY_BUTTON_CLASS } from './constants'
import type { CompatibilityPlan } from './compatibilityPlan'

/**
 * Shown only when this runtime version cannot be used with this Ramu release: what is wrong and the fix, nothing else.
 * Versions that work, including ones no rule covers yet, stay out of the way.
 */
export function ProviderCompatibility({
  status,
  plan,
  stale,
  busy,
  onUpdate,
  onUpdateRamu,
  onCheckAgain,
  onChangePath,
}: {
  status: ProviderStatus
  plan: CompatibilityPlan
  /** The host could not be reached, so this is its last known result. */
  stale: boolean
  busy: boolean
  onUpdate: () => void
  onUpdateRamu?: () => void
  onCheckAgain: () => void
  onChangePath: () => void
}) {
  const text = incompatibleText(status, plan, t)
  if (!text) return null
  const message = stale ? `${text} ${t('Showing the last result; the host is not reachable.')}` : text
  return (
    <div className="grid gap-2" role="alert">
      <p className="m-0 max-w-[520px] text-caption leading-[18px] text-bad">{message}</p>
      <div className="flex flex-wrap gap-2">
        {plan.actions.includes('update') && (
          <Button variant="secondary" size="sm" className={SECONDARY_BUTTON_CLASS} disabled={busy} onClick={onUpdate}>
            {status.latestVersion ? t('Update to {0}', { '0': status.latestVersion }) : t('Update')}
          </Button>
        )}
        {plan.actions.includes('update-ramu') && onUpdateRamu && (
          <Button variant="secondary" size="sm" className={SECONDARY_BUTTON_CLASS} onClick={onUpdateRamu}>
            {t('Update Ramu')}
          </Button>
        )}
        {plan.actions.includes('change-path') && (
          <Button variant="ghost" size="sm" className="text-caption" onClick={onChangePath}>
            {t('Change executable path')}
          </Button>
        )}
        {plan.actions.includes('check-again') && (
          <Button variant="ghost" size="sm" className="text-caption" disabled={busy} onClick={onCheckAgain}>
            {t('Check again')}
          </Button>
        )}
      </div>
    </div>
  )
}
