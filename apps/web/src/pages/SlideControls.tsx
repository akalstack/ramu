import { useCallback, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../components/desktop-button'
import { GHOST_ICON_BUTTON_CLASS } from '../components/button-classes'
import { t } from '../i18n'

/** Moves through a deck shown in the artifact's frame, one slide at a time. */
export function useSlideControls(frame: RefObject<HTMLIFrameElement | null>, instance: string, count: number) {
  const [index, setIndex] = useState(0)
  const show = useCallback(
    (next: number) => {
      const bounded = Math.max(0, Math.min(count - 1, next))
      setIndex(bounded)
      frame.current?.contentWindow?.postMessage(
        { ramuInteractive: 1, instance, type: 'slide', value: { index: bounded, present: false } },
        '*',
      )
    },
    [frame, instance, count],
  )
  return { index, show }
}

/** Previous, next and where the reader is in the deck, for the artifact view's toolbar. */
export function SlideToolbar({
  controls,
  count,
  disabled,
}: {
  controls: ReturnType<typeof useSlideControls>
  count: number
  disabled: boolean
}) {
  const { index, show } = controls
  return (
    <div role="group" aria-label={t('Slides')} className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        className={GHOST_ICON_BUTTON_CLASS}
        aria-label={t('Previous slide')}
        title={t('Previous slide')}
        disabled={disabled || index === 0}
        onClick={() => show(index - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      <span className="min-w-14 text-center text-caption text-muted-foreground tabular-nums" aria-live="polite">
        {t('{current} of {count}', { current: index + 1, count })}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className={GHOST_ICON_BUTTON_CLASS}
        aria-label={t('Next slide')}
        title={t('Next slide')}
        disabled={disabled || index >= count - 1}
        onClick={() => show(index + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}
