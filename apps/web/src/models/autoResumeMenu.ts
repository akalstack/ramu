import {
  autoResumeChoiceOf,
  autoResumeItems,
  autoResumeStateLabel,
  type AutoResumeChoice,
} from '@ramu/shared/chat/limitPolicy'
import { effectiveAutoResume } from '@ramu/shared/chat/providerWait'
import type { AgentSettings, FallbackPreferences } from '@ramu/shared/types'
import type { MenuEntry } from '../Menu'
import { t } from '../i18n'

/** A thread's auto-resume at a usage limit: its own choice, what that resolves to, and how to change it. */
export interface AutoResumeControl {
  choice: AutoResumeChoice
  effective: { value: boolean; source: 'thread' | 'default' }
  /** The global default, which "Use default" follows. */
  globalOn: boolean
  set: (choice: AutoResumeChoice) => void
}

/** Derive the control from the thread's settings and the global preference. */
export function autoResumeControl(
  settings: Pick<AgentSettings, 'autoResume'>,
  fallback: Partial<Pick<FallbackPreferences, 'autoResume'>> | undefined,
  set: (choice: AutoResumeChoice) => void,
): AutoResumeControl {
  return {
    choice: autoResumeChoiceOf(settings),
    effective: effectiveAutoResume(settings, fallback),
    globalOn: fallback?.autoResume !== false,
    set,
  }
}

/** The label on the control: "Auto-resume: On (default)". */
export const autoResumeLabel = (control: Pick<AutoResumeControl, 'effective'>) =>
  t('Auto-resume: {0}', { 0: t(autoResumeStateLabel(control.effective)) })

/** The three items (Use default, On, Off), with the current one selected, as menu entries. */
export function autoResumeEntries(control: AutoResumeControl): MenuEntry[] {
  return autoResumeItems(control.globalOn, control.choice).map((item) => ({
    key: `auto-resume-${item.choice}`,
    label: t(item.label),
    selected: item.selected,
    onSelect: () => control.set(item.choice),
  }))
}

/** Heading plus the three items, for menus that hold other things too (the provider chip). */
export const autoResumeSection = (control: AutoResumeControl): MenuEntry[] => [
  { key: 'auto-resume-heading', heading: t('Auto-resume at a usage limit') },
  ...autoResumeEntries(control),
]
