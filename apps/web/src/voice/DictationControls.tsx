import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Mic, X } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Spinner } from '@/components/ui/spinner'
import {
  DICTATION_MAX_MS,
  VOICE_WAVE_SILENT,
  VOICE_WAVE_TICK_MS,
  nextVoiceWave,
  type DictationFailure,
  type DictationState,
} from '@ramu/shared/voice/dictation'
import { formatElapsed } from '@ramu/shared/voice/settings'
import { copyText } from '../ipc'
import { t } from '../i18n'

export const dictationFailureText = (reason: DictationFailure): string =>
  t(
    {
      permission: 'Microphone or speech access was not allowed. Turn it on in system settings to dictate.',
      unavailable: 'Dictation is not available on this computer. Typing and system dictation still work.',
      language: 'This computer cannot recognize the chosen language offline.',
      model: 'The speech model could not be downloaded.',
      capture: 'The microphone could not be used. Your message is unchanged.',
      recognition: 'Speech could not be recognized. Your message is unchanged.',
      empty: 'No speech was heard. Your message is unchanged.',
      interrupted: 'Recording stopped. Your message is unchanged.',
    }[reason],
  )

/** Elapsed recording time, ticking on its own so the composer does not re-render with it. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])
  return <>{formatElapsed(Math.min(now - since, DICTATION_MAX_MS))}</>
}

/** Recent microphone level, not recognition progress. Reduced motion leaves the level on the dot alone. */
function VoiceWave({ level }: { level: number }) {
  const latest = useRef(level)
  latest.current = level
  const [wave, setWave] = useState(VOICE_WAVE_SILENT)
  useEffect(() => {
    const timer = window.setInterval(() => setWave((bars) => nextVoiceWave(bars, latest.current)), VOICE_WAVE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <span
      aria-hidden="true"
      className="flex h-4 min-w-0 flex-1 items-center gap-0.5 overflow-hidden motion-reduce:invisible [:root[data-reduce-motion]_&]:invisible"
    >
      {wave.map((bar, index) => (
        <span
          key={index}
          className="w-0.5 flex-none rounded-full bg-muted-foreground transition-[height] duration-180 ease-out motion-reduce:transition-none"
          style={{ height: `${Math.max(12, bar * 100)}%` }}
        />
      ))}
    </span>
  )
}

/**
 * The microphone in the composer bar. It stays a microphone during a take because a square here would read as the
 * turn's Stop beside it. Mouse down is cancelled so the editor keeps focus and its selection: the take inserts where
 * the caret was, not where the click landed.
 */
export function MicButton({
  active,
  disabled,
  title,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  title: string
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={`icon small-icon${active ? ' text-bad!' : ''}`}
      type="button"
      aria-label={t('Dictate message')}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Mic size={15} />
    </Button>
  )
}

function Pill({ children, strong, onClick }: { children: ReactNode; strong?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="xs"
      variant={strong ? 'default' : 'secondary'}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function IconAction({
  label,
  hint,
  strong,
  onClick,
  children,
}: {
  label: string
  hint?: string
  strong?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant={strong ? 'default' : 'ghost'}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/**
 * Status above the message box while a take is active or has something to say. A running take is one flat line of the
 * composer, with Cancel and the only violet control together on the right; review and failures are shaded notices.
 */
export function DictationStatus({
  state,
  level,
  onStop,
  onCancel,
  onInsert,
  onDismiss,
  onOpenSettings,
}: {
  state: DictationState
  level: number
  onStop: () => void
  onCancel: () => void
  /** Review only: insert the held transcript at the current cursor. */
  onInsert: () => void
  onDismiss: () => void
  onOpenSettings?: () => void
}) {
  if (state.phase === 'idle') return null
  const line = 'composer-voice mb-1 flex min-h-7 items-center gap-2 text-control'
  const row = 'composer-voice mb-1 flex items-center gap-2 rounded-(--radius-s) bg-fill px-3 py-1.5 text-control'
  if (state.phase === 'preparing' || state.phase === 'transcribing') {
    return (
      <div className={line} role="status" aria-live="polite">
        <Spinner className="size-3.5 flex-none text-muted-foreground" role="presentation" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-muted-foreground">
          {state.phase === 'preparing' ? t('Getting the microphone ready…') : t('Transcribing on this computer…')}
        </span>
        {state.phase === 'transcribing' && (
          <IconAction label={t('Discard')} hint="Esc" onClick={onCancel}>
            <X size={14} />
          </IconAction>
        )}
      </div>
    )
  }
  if (state.phase === 'recording' || state.phase === 'limit') {
    const limit = state.phase === 'limit'
    return (
      <div className={line}>
        <span
          aria-hidden="true"
          className={`size-2.5 flex-none rounded-full ${limit ? 'bg-warn' : 'bg-bad'}`}
          style={{ opacity: limit ? 1 : 0.6 + level * 0.4 }}
        />
        {/* Only the phase is announced: the clock inside a live region would be read out on every tick. */}
        <span className={`min-w-0 flex-none ${limit ? 'text-warn' : 'text-muted-foreground'}`}>
          <span role="status" aria-live="polite">
            {limit ? t('Recording limit reached') : t('Recording')}
          </span>
          {!limit && (
            <span aria-hidden="true" className="ml-1 tabular-nums">
              <Elapsed since={state.startedAt} />
            </span>
          )}
        </span>
        {limit ? <span className="flex-1" /> : <VoiceWave level={level} />}
        <IconAction label={limit ? t('Discard') : t('Cancel recording')} hint="Esc" onClick={onCancel}>
          <X size={14} />
        </IconAction>
        <IconAction label={limit ? t('Transcribe') : t('Stop and transcribe')} hint="Enter" strong onClick={onStop}>
          <Check size={14} strokeWidth={2.5} />
        </IconAction>
      </div>
    )
  }
  if (state.phase === 'review') {
    return (
      <div className={`${row} flex-col items-stretch`} role="group" aria-label={t('Transcript ready')}>
        <span className="font-medium">{t('Transcript ready')}</span>
        <span className="text-caption text-muted-foreground">
          {t('The message changed while you spoke, so nothing was inserted.')}
        </span>
        <span className="line-clamp-3">{state.text}</span>
        <span className="flex gap-2">
          <Pill strong onClick={onInsert}>
            {t('Insert at cursor')}
          </Pill>
          <Pill onClick={() => void copyText(state.text)}>{t('Copy')}</Pill>
          <Pill onClick={onDismiss}>{t('Discard')}</Pill>
        </span>
      </div>
    )
  }
  return (
    <div className={row} role="alert">
      <span className="min-w-0 flex-1 text-muted-foreground">{dictationFailureText(state.reason)}</span>
      {state.reason === 'permission' && onOpenSettings && <Pill onClick={onOpenSettings}>{t('Open settings')}</Pill>}
      <Pill onClick={onDismiss}>{t('Discard')}</Pill>
    </div>
  )
}
