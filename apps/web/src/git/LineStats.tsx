import { t, useLanguage } from '../i18n'
import type { ChangeFile } from '@ramu/shared/types'
export function LineStats({ files }: { files: ChangeFile[] }) {
  useLanguage()
  const text = files.filter((file) => !file.binary)
  if (!text.length || text.some((file) => file.addedLines === undefined || file.removedLines === undefined)) return null
  const added = text.reduce((sum, file) => sum + file.addedLines!, 0),
    removed = text.reduce((sum, file) => sum + file.removedLines!, 0)
  return (
    <span
      className="line-stats inline-flex gap-1.5 items-center flex-none text-caption tabular-nums whitespace-nowrap"
      aria-label={t('{0} lines added, {1} lines removed', { '0': added, '1': removed })}
      title={t('{0} lines added · {1} lines removed', { '0': added, '1': removed })}
    >
      <span className="lines-added text-ok">+{added}</span>
      <span className="lines-removed text-bad">−{removed}</span>
    </span>
  )
}
