import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { compatibilitySummary } from '@ramu/shared/providers/compatibility'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import { t } from '../i18n'
import { SECONDARY_BUTTON_CLASS } from './constants'
import type { CompatibilityPlan } from './compatibilityPlan'

/** Quiet status beside the installed version, with details and the next useful recovery action. */
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
  const result = status.compatibility
  if (!result) return null
  const bad = result.status === 'incompatible'
  const summary = compatibilitySummary(result)
  const checked = result.checkedAt ? new Date(result.checkedAt).toLocaleString() : null
  return (
    <div className="grid gap-1.5">
      <p
        className={`small text-caption ${bad ? 'text-bad' : 'muted text-muted-foreground'}`}
        role={bad ? 'alert' : 'status'}
      >
        {t(summary.key, summary.values)}
        {result.affects?.length ? ` ${result.affects.join(', ')}.` : ''}
        {result.recommend ? ` ${t('Recommended version: {0}', { '0': result.recommend })}` : ''}
        {stale ? ` ${t('Showing the last result; the host is not reachable.')}` : ''}
      </p>
      {plan.manualInstall && (
        <p className="muted text-muted-foreground small text-caption">
          {t('Ramu cannot pick a compatible release for you. Install a compatible version manually, then check again.')}
        </p>
      )}
      {plan.actions.length > 0 && (
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
            <Button variant="ghost" size="sm" className="small text-caption" onClick={onChangePath}>
              {t('Change executable path')}
            </Button>
          )}
          {plan.actions.includes('check-again') && (
            <Button variant="ghost" size="sm" className="small text-caption" disabled={busy} onClick={onCheckAgain}>
              {t('Check again')}
            </Button>
          )}
        </div>
      )}
      <Collapsible>
        <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="small text-caption" />}>
          {t('Compatibility details')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="muted text-muted-foreground small text-caption m-0 grid gap-0.5">
            <div>
              {t('Runtime')}: {result.runtime}
            </div>
            <div>
              {t('Observed version')}: {result.observedVersion ?? t('Unknown')}
            </div>
            <div>
              {t('Policy revision')}: {result.policyRevision}
            </div>
            {result.evidence && (
              <div>
                {t('Evidence')}: {result.evidence}
              </div>
            )}
            {checked && (
              <div>
                {t('Checked')}: {checked}
              </div>
            )}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
