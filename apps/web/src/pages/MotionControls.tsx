import { useState, type RefObject } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '../components/desktop-button'
import { GHOST_ICON_BUTTON_CLASS } from '../components/button-classes'
import { t } from '../i18n'

/**
 * Play, pause, restart and scrub a motion shown in the artifact's frame. The frame steps its own CSS animations, so
 * the scrubbed frame is exactly the one the exported video has at that time.
 */
export function MotionToolbar({
  frame,
  instance,
  seconds,
  disabled,
}: {
  frame: RefObject<HTMLIFrameElement | null>
  instance: string
  seconds: number
  disabled: boolean
}) {
  const [playing, setPlaying] = useState(true)
  const [at, setAt] = useState(0)
  const send = (value: { action: 'play' | 'pause' | 'seek'; ms?: number }) =>
    frame.current?.contentWindow?.postMessage({ ramuInteractive: 1, instance, type: 'motion', value }, '*')
  return (
    <div role="group" aria-label={t('Motion controls')} className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className={GHOST_ICON_BUTTON_CLASS}
        disabled={disabled}
        aria-label={playing ? t('Pause') : t('Play')}
        title={playing ? t('Pause') : t('Play')}
        onClick={() => {
          send({ action: playing ? 'pause' : 'play' })
          setPlaying(!playing)
        }}
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={GHOST_ICON_BUTTON_CLASS}
        disabled={disabled}
        aria-label={t('Play from the start')}
        title={t('Play from the start')}
        onClick={() => {
          send({ action: 'seek', ms: 0 })
          send({ action: 'play' })
          setAt(0)
          setPlaying(true)
        }}
      >
        <RotateCcw size={13} />
      </Button>
      <input
        type="range"
        aria-label={t('Position in the motion')}
        className="w-28 accent-(--accent)"
        min={0}
        max={seconds}
        step={0.1}
        value={at}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value)
          setAt(next)
          setPlaying(false)
          send({ action: 'seek', ms: next * 1000 })
        }}
      />
      <span className="w-14 text-caption text-muted-foreground tabular-nums">
        {at.toFixed(1)} / {seconds}s
      </span>
    </div>
  )
}
