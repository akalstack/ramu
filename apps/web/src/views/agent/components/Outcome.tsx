import { t as translate, useLanguage } from '../../../i18n'

/** How a permission or question request ended: Allowed, Denied, Answered or Cancelled. */
export function Outcome({ outcome }: { outcome: string | undefined }) {
  useLanguage()
  if (!outcome) return null
  const text =
    outcome === 'allowed-auto'
      ? 'Allowed by Auto'
      : outcome === 'allowed'
        ? 'Allowed once'
        : outcome === 'allowed-project'
          ? 'Allowed for this project'
          : outcome === 'allowed-user'
            ? 'Allowed for this user'
            : outcome === 'allowed-project-forgotten'
              ? 'Allowed · project approval forgotten'
              : outcome === 'allowed-user-forgotten'
                ? 'Allowed · user approval forgotten'
                : outcome === 'denied'
                  ? 'Denied'
                  : outcome === 'answered'
                    ? 'Answered'
                    : 'Cancelled'
  return <div className="outcome text-caption text-muted-foreground mt-1.5">{translate(text)}</div>
}
