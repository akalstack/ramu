import type { AppPreferences } from '@ramu/shared/types'

/** The agent features that change how many model tokens Ramu spends, as onboarding switches. */
export interface TokenChoices {
  toolSearch: boolean
  crossThreadRecall: boolean
  learning: boolean
  autoGoals: boolean
}

export type TokenFeature = keyof TokenChoices

/** Titles and help are translation keys. `saves` features lower token use when on; the rest raise it. */
export const TOKEN_FEATURES: { key: TokenFeature; title: string; help: string; cost: 'saves' | 'more' }[] = [
  {
    key: 'toolSearch',
    title: 'Load tools on demand',
    help: 'Optional Ramu tools stay out of the prompt until the agent asks for them.',
    cost: 'saves',
  },
  {
    key: 'crossThreadRecall',
    title: 'Recall past conversations',
    help: 'Agents can search your earlier threads for context.',
    cost: 'more',
  },
  {
    key: 'learning',
    title: 'Automatic learning',
    help: 'After a thread, a background review proposes notes and reusable skills for you to approve.',
    cost: 'more',
  },
  {
    key: 'autoGoals',
    title: 'Continue goals automatically',
    help: 'When a thread has a goal, the agent keeps going until it is met, up to a turn limit.',
    cost: 'more',
  },
]

/** Only the switch that saves tokens stays on. */
export const FEWEST_TOKENS: TokenChoices = {
  toolSearch: true,
  crossThreadRecall: false,
  learning: false,
  autoGoals: false,
}

export function tokenChoicesOf(preferences: AppPreferences): TokenChoices {
  return {
    toolSearch: preferences.intelligence.toolSearch,
    crossThreadRecall: preferences.intelligence.crossThreadRecall,
    learning: preferences.intelligence.learning !== 'off',
    autoGoals: preferences.goals.mode === 'auto',
  }
}

/** Writes the choices back; learning that was already saving automatically keeps doing so. */
export function applyTokenChoices(preferences: AppPreferences, choices: TokenChoices): AppPreferences {
  const learning = choices.learning
    ? preferences.intelligence.learning === 'off'
      ? 'review'
      : preferences.intelligence.learning
    : 'off'
  return {
    ...preferences,
    goals: { ...preferences.goals, mode: choices.autoGoals ? 'auto' : 'manual' },
    intelligence: {
      ...preferences.intelligence,
      toolSearch: choices.toolSearch,
      crossThreadRecall: choices.crossThreadRecall,
      learning,
    },
  }
}

export const sameChoices = (a: TokenChoices, b: TokenChoices) => TOKEN_FEATURES.every(({ key }) => a[key] === b[key])
