import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Presentation } from 'lucide-react'
import { Button } from '../components/desktop-button'
import { GHOST_ICON_BUTTON_CLASS, GHOST_TEXT_BUTTON_CLASS } from '../components/button-classes'
import { t } from '../i18n'
import { appThemeVariables } from '../interactive/InteractiveContent'
import { audienceScreen, openPresenterWindow, showPresenterSlide, type PresenterSlide } from './PresenterNotes'

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

/**
 * Moves through a deck shown in the artifact's frame, and presents it: the frame's stage fills the screen and shows one
 * slide at a time, turned with the arrow keys, Space or Page Up and Down, until Escape.
 */
export function useSlideControls(
  frame: RefObject<HTMLIFrameElement | null>,
  stage: RefObject<HTMLDivElement | null>,
  instance: string,
  count: number,
  /** A slide's title, notes and the next slide's title, for the presenter window on another display. */
  slideAt?: (index: number) => Omit<PresenterSlide, 'index' | 'count'>,
) {
  const [index, setIndex] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const notes = useRef<{ window: Window; since: number } | null>(null)
  const show = useCallback(
    (next: number, present: boolean) => {
      const bounded = Math.max(0, Math.min(count - 1, next))
      setIndex(bounded)
      frame.current?.contentWindow?.postMessage(
        { ramuInteractive: 1, instance, type: 'slide', value: { index: bounded, present } },
        '*',
      )
      if (notes.current && slideAt)
        showPresenterSlide(
          notes.current.window,
          { ...slideAt(bounded), index: bounded, count },
          notes.current.since,
          appThemeVariables(),
        )
    },
    [frame, instance, count, slideAt],
  )
  const closeNotes = () => {
    notes.current?.window.close()
    notes.current = null
  }
  useEffect(() => {
    if (!presenting) return
    const key = (event: KeyboardEvent) => {
      const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0
      const jump = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null
      if (!step && jump === null) return
      event.preventDefault()
      show(jump ?? index + step, true)
    }
    const left = () => {
      if (window.document.fullscreenElement) return
      closeNotes()
      setPresenting(false)
      show(index, false)
    }
    window.addEventListener('keydown', key)
    window.document.addEventListener('fullscreenchange', left)
    return () => {
      window.removeEventListener('keydown', key)
      window.document.removeEventListener('fullscreenchange', left)
    }
  }, [presenting, index, count, show])
  // With a second display the deck fills it and the speaker notes open on this one; otherwise the deck fills this one.
  const present = () =>
    void (async () => {
      const audience = slideAt ? await audienceScreen() : null
      await stage.current?.requestFullscreen(
        (audience ? { screen: audience } : undefined) as unknown as FullscreenOptions,
      )
      const opened = audience ? openPresenterWindow() : null
      notes.current = opened ? { window: opened, since: Date.now() } : null
      setPresenting(true)
      show(index, true)
    })().catch(() => {})
  return { index, presenting, show, present }
}

/** Previous, next, where the reader is in the deck, and Present, for the artifact view's toolbar. */
export function SlideToolbar({
  controls,
  count,
  disabled,
}: {
  controls: ReturnType<typeof useSlideControls>
  count: number
  disabled: boolean
}) {
  const { index, show, present } = controls
  return (
    <div role="group" aria-label={t('Slides')} className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        className={GHOST_ICON_BUTTON_CLASS}
        aria-label={t('Previous slide')}
        title={t('Previous slide')}
        disabled={disabled || index === 0}
        onClick={() => show(index - 1, false)}
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
        onClick={() => show(index + 1, false)}
      >
        <ChevronRight size={14} />
      </Button>
      <Button
        variant="ghost"
        className={GHOST_TEXT_BUTTON_CLASS}
        disabled={disabled}
        title={t('Show one slide at a time, full screen. Press Escape to stop.')}
        onClick={present}
      >
        <Presentation size={13} /> {t('Present')}
      </Button>
    </div>
  )
}
