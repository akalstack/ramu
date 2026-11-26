import { t, useLanguage } from '../../../i18n'

/** "×3" beside a notice shown once for a run of the same one; nothing for a single occurrence. */
export function RepeatCount({ count }: { count: number | undefined }) {
  useLanguage()
  if (!count || count < 2) return null
  const said = t('Happened {0} times in a row', { 0: count })
  return (
    <span
      className="flex-none rounded-full bg-fill px-1.5 text-micro font-medium tabular-nums text-muted-foreground"
      title={said}
    >
      <span aria-hidden="true">{t('×{0}', { 0: count })}</span>
      <span className="sr-only">{said}</span>
    </span>
  )
}
