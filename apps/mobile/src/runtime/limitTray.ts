import {
  autoResumeChoiceOf,
  autoResumeItems,
  autoResumeStateLabel,
  type AutoResumeChoice,
} from '@ramu/shared/chat/limitPolicy'
import { effectiveAutoResume, limitTrayView, type LimitTrayCase } from '@ramu/shared/chat/providerWait'
import type { AgentSettings, AppPreferences } from '@ramu/shared/types'
import type { TranscriptItem } from './types'

/**
 * The open limit wait in a thread's transcript, or null when it is not at a limit. A done thread waits on nothing: it
 * continues only when the person reopens it or sends a message.
 */
export function limitWaitOf(items: readonly TranscriptItem[], doneAt?: number | null) {
  if (doneAt) return null
  const note = items.findLast((item) => item.kind === 'note' && item.wait && item.limit)
  return note?.kind === 'note' && note.limit ? note.limit : null
}

/** Copy keys in `i18n.ts`; the screen turns them into words so the model stays testable without React Native. */
export type LimitDetailKey =
  | 'limitAutoKnown'
  | 'limitAutoUnknown'
  | 'limitOffKnownThread'
  | 'limitOffKnownDefault'
  | 'limitOffUnknownThread'
  | 'limitOffUnknownDefault'
  | 'limitResetOff'
  | 'limitStillKnown'
  | 'limitStillUnknown'

export interface LimitTrayModel {
  case: LimitTrayCase
  /** Bold title: "Limit reached", "Limit has reset" or, after a try that did not get through, "Still limited". */
  title: 'limitReached' | 'limitHasReset' | 'limitStill'
  detail: LimitDetailKey
  /** The time to put in the detail, when the reset is known. */
  resetAt?: number
  /** Which button, and whether it is the main one. */
  action: 'try-again' | 'try-anyway' | 'resume'
  primary: boolean
  autoResume: { value: boolean; source: 'thread' | 'default' }
  /** The label on the Auto-resume control, in the shared English keys ("On (default)", "Off"). */
  autoResumeLabel: string
}

/**
 * What the thread tray says at a usage limit: the plan's five rows plus "Still limited" after a try that did not get
 * through. Auto-resume is the thread's own choice, else the host's default.
 */
export function limitTrayModel(
  wait: { retryAt: number; guessed: boolean },
  settings: Pick<AgentSettings, 'autoResume'> | undefined,
  fallback: Partial<AppPreferences['fallback']> | undefined,
  options: { now?: number; stillLimited?: boolean } = {},
): LimitTrayModel {
  const autoResume = effectiveAutoResume(settings ?? {}, fallback)
  const view = limitTrayView(wait, autoResume.value, options.now)
  const thread = autoResume.source === 'thread'
  const known = view.resetAt !== undefined
  const detail: LimitDetailKey = options.stillLimited
    ? known
      ? 'limitStillKnown'
      : 'limitStillUnknown'
    : {
        'auto-known': 'limitAutoKnown' as const,
        'auto-unknown': 'limitAutoUnknown' as const,
        'off-known': thread ? ('limitOffKnownThread' as const) : ('limitOffKnownDefault' as const),
        'off-unknown': thread ? ('limitOffUnknownThread' as const) : ('limitOffUnknownDefault' as const),
        'reset-off': 'limitResetOff' as const,
      }[view.case]
  return {
    case: view.case,
    title: options.stillLimited ? 'limitStill' : view.case === 'reset-off' ? 'limitHasReset' : 'limitReached',
    detail,
    ...(view.resetAt !== undefined ? { resetAt: view.resetAt } : {}),
    action: view.action,
    primary: view.primary,
    autoResume,
    autoResumeLabel: autoResumeStateLabel(autoResume),
  }
}

/** The three Auto-resume items for a thread, with the host's default named. */
export function autoResumeMenu(
  settings: Pick<AgentSettings, 'autoResume'> | undefined,
  fallback: Partial<AppPreferences['fallback']> | undefined,
): { choice: AutoResumeChoice; label: string; selected: boolean }[] {
  return autoResumeItems(fallback?.autoResume !== false, autoResumeChoiceOf(settings ?? {}))
}

/** Composer words while at a limit, as copy keys: the placeholder follows auto-resume and whether the reset is known. */
export function limitPlaceholderKey(model: Pick<LimitTrayModel, 'autoResume' | 'resetAt'>) {
  if (!model.autoResume.value) return 'limitPlaceholderManual' as const
  return model.resetAt !== undefined ? ('limitPlaceholderAtReset' as const) : ('limitPlaceholderClears' as const)
}
