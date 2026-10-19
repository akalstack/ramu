import type { AgentSettings, AppPreferences } from '../types'

/**
 * What a thread does at a usage limit, as the one global choice "When a usage limit is reached". It is stored as two
 * values on purpose (`defaultAutoFallback` and `fallback.autoResume`), so data, schedules and sub-agents that read
 * `autoFallback` keep working.
 */
export type LimitChoice = 'switch' | 'wait' | 'stop' | 'switch-then-stop'

type PolicyPreferences = Pick<AppPreferences, 'defaultAutoFallback'> & {
  fallback?: Partial<Pick<AppPreferences['fallback'], 'autoResume'>>
}

/** The option the stored pair stands for. Fallback on with auto-resume off is the hidden fourth combination. */
export function limitChoiceOf(preferences: PolicyPreferences): LimitChoice {
  const resume = preferences.fallback?.autoResume !== false
  if (preferences.defaultAutoFallback) return resume ? 'switch' : 'switch-then-stop'
  return resume ? 'wait' : 'stop'
}

/** The two stored values an option writes. */
export function limitChoicePatch(choice: LimitChoice): { defaultAutoFallback: boolean; autoResume: boolean } {
  return {
    defaultAutoFallback: choice === 'switch' || choice === 'switch-then-stop',
    autoResume: choice === 'switch' || choice === 'wait',
  }
}

/** Switching to another model is on, so "When to switch" and "Fallback order" apply. */
export const limitChoiceSwitches = (choice: LimitChoice) => choice === 'switch' || choice === 'switch-then-stop'

/** English keys (also the translation keys) for the options. The fourth one is offered only while it is the stored value. */
export const LIMIT_CHOICES: { value: LimitChoice; label: string }[] = [
  { value: 'switch', label: 'Switch to another model' },
  { value: 'wait', label: 'Wait on this model' },
  { value: 'stop', label: 'Stop and let me decide' },
]
export const HIDDEN_LIMIT_CHOICE = { value: 'switch-then-stop', label: 'Switch, then stop if none has room' } as const

export const LIMIT_CHOICE_TITLE = 'When a usage limit is reached'
export const LIMIT_CHOICE_HELP =
  'Switching applies to new threads. Waiting and stopping apply to every thread, including ones already waiting.'

/** The options to offer: the three, plus the fourth only when the stored pair is that combination. */
export function limitChoiceOptions(current: LimitChoice): { value: LimitChoice; label: string }[] {
  return current === 'switch-then-stop' ? [...LIMIT_CHOICES, HIDDEN_LIMIT_CHOICE] : LIMIT_CHOICES
}

/** A thread's own auto-resume choice: follow the global default, or force it on or off. */
export type AutoResumeChoice = 'default' | 'on' | 'off'

export const autoResumeChoiceOf = (settings: Pick<AgentSettings, 'autoResume'>): AutoResumeChoice =>
  settings.autoResume === undefined ? 'default' : settings.autoResume ? 'on' : 'off'

/** What to send to `agent.setAutoResume`: null clears the override. */
export const autoResumeOverride = (choice: AutoResumeChoice): boolean | null =>
  choice === 'default' ? null : choice === 'on'

/** English keys for the state shown on the control: "On (default)", "Off", ... */
export function autoResumeStateLabel(effective: { value: boolean; source: 'thread' | 'default' }): string {
  return effective.source === 'default'
    ? effective.value
      ? 'On (default)'
      : 'Off (default)'
    : effective.value
      ? 'On'
      : 'Off'
}

/** The three items of the per-thread control. "Use default" names what the default currently is. */
export function autoResumeItems(
  globalOn: boolean,
  current: AutoResumeChoice,
): { choice: AutoResumeChoice; label: string; selected: boolean }[] {
  return [
    { choice: 'default', label: globalOn ? 'Use default (on)' : 'Use default (off)' },
    { choice: 'on', label: 'On' },
    { choice: 'off', label: 'Off' },
  ].map((item) => ({ ...item, choice: item.choice as AutoResumeChoice, selected: item.choice === current }))
}
