import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'
import { ICON_BUTTON_CLASS, TEXT_BUTTON_CLASS } from './styles'

export function LargeDiffBanner({
  oneAtATime,
  activeIndex,
  count,
  onStep,
  onToggleAll,
}: {
  oneAtATime: boolean
  activeIndex: number
  count: number
  onStep: (delta: -1 | 1) => void
  onToggleAll: () => void
}) {
  return (
    <div
      className="review-large-banner [&_>_svg:first-child]:text-brand [&_>_svg:first-child]:flex-none flex items-center gap-2 p-[8px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-raised text-soft text-control"
      role="status"
    >
      <Info size={15} />
      <span className="grow flex-1 min-w-0 text-left">
        {oneAtATime ? t('This diff is large, showing one file at a time') : t('This diff is large')}
      </span>
      {oneAtATime && (
        <>
          <span className="muted text-muted-foreground small text-caption">
            {activeIndex + 1} / {count}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Previous file')}
            disabled={activeIndex === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Next file')}
            disabled={activeIndex >= count - 1}
            onClick={() => onStep(1)}
          >
            <ChevronRight size={15} />
          </Button>
        </>
      )}
      <Button variant="ghost" size="sm" className={TEXT_BUTTON_CLASS} onClick={() => onToggleAll()}>
        {oneAtATime ? t('Show all files') : t('One file at a time')}
      </Button>
    </div>
  )
}
