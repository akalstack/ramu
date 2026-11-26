import { useEffect, useState } from 'react'
import { t, useLanguage } from '../../i18n'

/** A listing this quick is not worth a placeholder: the rows replace it before it can be read. */
const SHOW_AFTER_MS = 300

/**
 * A folder whose contents are still being read. Nothing shows for a listing that arrives at once, so opening a folder
 * does not draw placeholder rows and then swap them for a different number of real ones; a slow listing gets one quiet
 * row, the height of a file, at the folder's depth.
 */
export function TreeLoading({ depth }: { depth: number }) {
  useLanguage()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])
  if (!shown) return null
  return (
    <div
      role="status"
      className="flex h-7 items-center text-caption text-muted-foreground"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {t('Loading…')}
    </div>
  )
}
