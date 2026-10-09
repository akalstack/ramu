import type { ChangeFile } from '../../shared/types'
export function LineStats({ files }: { files: ChangeFile[] }) {
  const text = files.filter((file) => !file.binary)
  if (!text.length || text.some((file) => file.addedLines === undefined || file.removedLines === undefined)) return null
  const added = text.reduce((sum, file) => sum + file.addedLines!, 0), removed = text.reduce((sum, file) => sum + file.removedLines!, 0)
  return <span className="line-stats" aria-label={`${added} lines added, ${removed} lines removed`} title={`${added} lines added · ${removed} lines removed`}><span className="lines-added">+{added}</span><span className="lines-removed">−{removed}</span></span>
}
