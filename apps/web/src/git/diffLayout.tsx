import { Columns2, Rows2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { ICON_BUTTON_CLASS } from '../changes/styles'

const KEY = 'ramu.review-layout'
const EVENT = 'ramu:diff-layout'

const savedSplit = () => {
  try {
    return localStorage.getItem(KEY) !== 'inline'
  } catch {
    return true
  }
}

/** Split or inline diffs: one saved choice shared by run reviews and Source Control file diffs, kept in sync live. */
export function useDiffLayout() {
  const [split, setSplit] = useState(savedSplit)
  useEffect(() => {
    const sync = () => setSplit(savedSplit())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  const change = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? 'split' : 'inline')
    } catch {}
    setSplit(next)
    window.dispatchEvent(new Event(EVENT))
  }
  return [split, change] as const
}

/** The Inline / Split segmented control. `narrow` keeps the saved choice but shows inline, with Split unavailable. */
export function DiffLayoutToggle({
  split,
  narrow = false,
  label,
  onChange,
}: {
  split: boolean
  narrow?: boolean
  label?: string
  onChange: (split: boolean) => void
}) {
  useLanguage()
  return (
    <div
      className="review-layout-toggle inline-flex flex-none gap-0.5 p-0.5 rounded-(--radius-s) bg-fill"
      role="group"
      aria-label={label ?? t('Diff layout')}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        aria-pressed={!split}
        aria-label={t('Inline')}
        title={t('Inline')}
        onClick={() => onChange(false)}
      >
        <Rows2 size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        aria-pressed={split}
        disabled={narrow}
        aria-label={t('Split')}
        title={narrow ? t('Split needs a wider pane') : t('Split')}
        onClick={() => onChange(true)}
      >
        <Columns2 size={14} />
      </Button>
    </div>
  )
}
