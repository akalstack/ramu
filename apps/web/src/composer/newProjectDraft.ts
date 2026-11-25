import { STACKS, STACK_IDS, type StackId } from '@ramu/shared/stacks'
import { t } from '../i18n'

/**
 * How a named project starts: the agent recommends a stack (`''`), one of Ramu's stacks, a framework the person types
 * (`other`, looked up by the agent), or no generator at all (`none`).
 */
export type StackChoice = '' | 'none' | 'other' | StackId

export interface NewProjectDraft {
  name: string
  stack: StackChoice
  /** The framework typed for `other`, such as Tauri. */
  framework: string
}

export const EMPTY_PROJECT_DRAFT: NewProjectDraft = { name: '', stack: '', framework: '' }

/** One of Ramu's own stacks, which it can create before the thread starts; null for every other choice. */
export const catalogStack = (draft: NewProjectDraft): StackId | null =>
  (STACK_IDS as readonly string[]).includes(draft.stack) ? (draft.stack as StackId) : null

/** Ramu creates a named project itself when it knows how: one of its stacks, or no generator. */
export const ramuMakesProject = (draft: NewProjectDraft): boolean =>
  !!draft.name.trim() && (draft.stack === 'none' || catalogStack(draft) !== null)

/** What the agent is asked when it makes the project: the name and framework the person gave, and where it goes. */
export function newProjectRequest(draft: NewProjectDraft, prompt: string, parent: string | null | undefined): string {
  const name = draft.name.trim()
  const framework = draft.stack === 'other' ? draft.framework.trim() : ''
  const request = !name
    ? t('Start a new project: {0}', { 0: prompt })
    : framework
      ? t('Start a new project named {0} with {1}: {2}', { 0: name, 1: framework, 2: prompt })
      : t('Start a new project named {0}, with the stack you recommend: {1}', { 0: name, 1: prompt })
  return name && parent ? `${request}\n\n${t('Put it in {0}.', { 0: parent })}` : request
}

/** Stacks named in words rather than after their framework; the rest are names, shown as they are in every language. */
const DESCRIBED = new Set<StackId>(['static', 'vite-vanilla', 'node'])

/** A stack's name as the picker shows it. */
export const stackName = (id: StackId): string => (DESCRIBED.has(id) ? t(STACKS[id].name) : STACKS[id].name)
