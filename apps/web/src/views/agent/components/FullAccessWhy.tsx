import { t as translate, useLanguage } from '../../../i18n'

/**
 * Under a permission request that Full access still asks about: why, in one line, so the person can decide at a glance
 * instead of opening an explanation first.
 */
export function FullAccessWhy({ reason }: { reason?: string }) {
  useLanguage()
  return (
    <p className="m-0 mt-2 text-caption text-muted-foreground">
      {reason
        ? translate('Full access still asks: {0}.', { 0: reason.replace(/\.$/, '') })
        : translate('Full access still asks before this.')}
    </p>
  )
}
