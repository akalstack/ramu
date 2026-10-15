import { t as translate, useLanguage } from '../../../i18n'

/** How a permission or question request ended: Allowed, Denied, Answered or Cancelled. */
export function Outcome({ outcome }: { outcome: string | undefined }) {
  useLanguage()
  if (!outcome) return null
  const text =
    outcome === 'allowed'
      ? 'Allowed'
      : outcome === 'denied'
        ? 'Denied'
        : outcome === 'answered'
          ? 'Answered'
          : 'Cancelled'
  return <div className="outcome text-caption text-muted-foreground mt-1.5">{translate(text)}</div>
}
