import { useEffect, useState, type ReactNode } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { DICTATION_MAX_MS, type DictationFailure, type DictationState } from '@ramu/shared/voice/dictation'
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

/**
 * The microphone in the composer bar. Mouse down is cancelled so the editor keeps focus and its selection: the take
 * inserts where the caret was, not where the click landed.
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
      className={`icon small-icon${active ? ' text-bad' : ''}`}
      type="button"
      aria-label={t('Dictate message')}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {active ? <Square size={13} fill="currentColor" strokeWidth={0} /> : <Mic size={15} />}
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

/**
 * Status above the message box while a take is active or has something to say. Cancel stays one click away; the dot
 * follows the microphone level, never recognition progress.
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
  const row = 'composer-voice mb-1 flex items-center gap-2 rounded-(--radius-s) bg-fill px-3 py-1.5 text-control'
  if (state.phase === 'preparing' || state.phase === 'transcribing') {
    return (
      <div className={row} role="status" aria-live="polite">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {state.phase === 'preparing' ? t('Getting the microphone ready…') : t('Transcribing on this computer…')}
        </span>
        {state.phase === 'transcribing' && <Pill onClick={onCancel}>{t('Discard')}</Pill>}
      </div>
    )
  }
  if (state.phase === 'recording' || state.phase === 'limit') {
    const limit = state.phase === 'limit'
    return (
      <div className={row} role="status" aria-live="polite">
        <span
          aria-hidden="true"
          className={`size-2.5 flex-none rounded-full ${limit ? 'bg-warn' : 'bg-bad'}`}
          style={{ opacity: limit ? 1 : 0.45 + level * 0.55 }}
        />
        <span className={`min-w-0 flex-1 ${limit ? 'text-warn' : 'text-muted-foreground'}`}>
          {limit ? (
            t('Recording limit reached')
          ) : (
            <>
              {t('Recording')} <Elapsed since={state.startedAt} />
            </>
          )}
        </span>
        <Pill onClick={onCancel}>{limit ? t('Discard') : t('Cancel recording')}</Pill>
        <Pill strong onClick={onStop}>
          {limit ? t('Transcribe') : t('Stop and transcribe')}
        </Pill>
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
