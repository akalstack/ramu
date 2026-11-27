import type { CheckoutMode, Task } from './types/workspace'

export type BranchNamingStrategy = 'fixed' | 'semantic' | 'custom'
/** An unresolved default remains distinct from a manual choice or an existing workspace. */
export interface WorkspaceChoice {
  mode: CheckoutMode | null
  workspaceId?: string
  name?: string
  branch?: BranchNameDraft
}

export function parseWorkspaceChoice(value: unknown): WorkspaceChoice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const choice = value as Record<string, unknown>
  if (choice.version !== 1 || ![null, 'current', 'worktree'].includes(choice.mode as string)) return null
  if (
    choice.workspaceId !== undefined &&
    (choice.mode !== 'worktree' ||
      typeof choice.workspaceId !== 'string' ||
      !choice.workspaceId.trim() ||
      choice.workspaceId.length > 100)
  )
    return null
  const branch = parseBranchNameDraft(choice.branch)
  if (choice.branch !== undefined && !branch) return null
  return {
    mode: choice.mode as CheckoutMode | null,
    workspaceId: choice.workspaceId as string | undefined,
    branch,
    name: typeof choice.name === 'string' && choice.name.length <= 200 ? choice.name : undefined,
  }
}

/** Versioned sidecar; callers keep text and attachment drafts independently. */
export function readWorkspaceChoice(text?: string): WorkspaceChoice {
  try {
    return parseWorkspaceChoice(JSON.parse(text ?? 'null')) ?? { mode: null }
  } catch {
    return { mode: null }
  }
}
/** Frozen with the draft/outbox; only this bounded request is sent to the naming model. */
export interface BranchNamingIntent {
  strategy: BranchNamingStrategy
  instructions: string
  prompt: string
}
export interface BranchChoice {
  name: string
  source: 'manual' | 'generated' | 'fallback'
}
/** Manual edits survive prompt changes; generated candidates belong to one naming request. */
export interface BranchNameDraft {
  title: string
  intent: BranchNamingIntent
  choice: BranchChoice
}
export function parseBranchNameDraft(value: unknown): BranchNameDraft | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const draft = value as BranchNameDraft
  const intent = draft.intent
  const choice = draft.choice
  if (
    Object.keys(draft).some((key) => !['title', 'intent', 'choice'].includes(key)) ||
    typeof draft.title !== 'string' ||
    draft.title.length > 200 ||
    !intent ||
    Object.keys(intent).some((key) => !['strategy', 'instructions', 'prompt'].includes(key)) ||
    !['fixed', 'semantic', 'custom'].includes(intent.strategy) ||
    typeof intent.instructions !== 'string' ||
    intent.instructions.length > 2000 ||
    typeof intent.prompt !== 'string' ||
    intent.prompt.length > 6000 ||
    !choice ||
    Object.keys(choice).some((key) => !['name', 'source'].includes(key)) ||
    typeof choice.name !== 'string' ||
    choice.name.length > 160 ||
    !['manual', 'generated', 'fallback'].includes(choice.source) ||
    (choice.source !== 'manual' && !validBranchName(choice.name))
  )
    return
  return {
    title: draft.title,
    intent: { strategy: intent.strategy, instructions: intent.instructions, prompt: intent.prompt },
    choice: { name: choice.name, source: choice.source },
  }
}
export function currentBranchChoice(
  draft: BranchNameDraft | undefined,
  title: string,
  intent: BranchNamingIntent,
): BranchChoice | undefined {
  if (!draft) return
  if (
    draft.choice.source === 'manual' ||
    (draft.title === title &&
      draft.intent.strategy === intent.strategy &&
      draft.intent.instructions === intent.instructions &&
      draft.intent.prompt === intent.prompt)
  )
    return draft.choice
}
export interface WorkspaceDefaults {
  defaultCheckoutMode: CheckoutMode
  worktreeBranchNaming: BranchNamingStrategy
  worktreeBranchPrefix: string
  worktreeBranchInstructions: string
}
export const DEFAULT_WORKSPACE_PREFERENCES: WorkspaceDefaults = {
  defaultCheckoutMode: 'current',
  worktreeBranchNaming: 'fixed',
  worktreeBranchPrefix: 'ramu/',
  worktreeBranchInstructions: '',
}
export function validBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/.test(name) &&
    !name.includes('..') &&
    !name.includes('//') &&
    name
      .split('/')
      .every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')) &&
    name !== 'HEAD'
  )
}
export function validBranchPrefix(prefix: string): boolean {
  return prefix.length <= 120 && (prefix === '' || validBranchName(`${prefix.replace(/\/$/, '')}/task`))
}
export function branchForTitle(title: string, prefix = 'ramu/'): string {
  if (!validBranchPrefix(prefix)) throw new Error('Invalid Git branch prefix')
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'task'
  return `${prefix ? `${prefix.replace(/\/$/, '')}/` : ''}${slug}`
}
export function resolveCheckoutMode(input: {
  defaultMode: CheckoutMode
  manual?: CheckoutMode | null
  workspaceId?: string | null
  projectFree?: boolean
  worktreeUnavailable?: string | null
}): { mode: CheckoutMode; source: 'default' | 'manual' | 'workspace'; reason: string | null; blocked: boolean } {
  const source = input.workspaceId ? 'workspace' : input.manual ? 'manual' : 'default'
  const mode = input.workspaceId ? 'worktree' : (input.manual ?? input.defaultMode)
  if (input.projectFree)
    return { mode: 'current', source, reason: null, blocked: Boolean(input.workspaceId || input.manual === 'worktree') }
  if (mode === 'worktree' && source !== 'workspace' && input.worktreeUnavailable)
    return {
      mode: source === 'default' ? 'current' : 'worktree',
      source,
      reason: input.worktreeUnavailable,
      blocked: source !== 'default',
    }
  return { mode, source, reason: null, blocked: false }
}

/**
 * Who else is in this project's own checkout, when a new thread would join them only because that is the default:
 * threads with a turn running, and threads that finished leaving changes uncommitted there. A choice the person made,
 * or a worktree that cannot be made, is never second-guessed.
 */
export function checkoutBusyForDefault<T extends Pick<Task, 'projectId' | 'mode' | 'status'>>(input: {
  resolution: { mode: CheckoutMode; source: 'default' | 'manual' | 'workspace' }
  projectId: string
  threads: readonly T[]
  worktreeUnavailable?: string | null
  /** Whether a thread's changes are still uncommitted in the checkout, as its host reports. */
  leftChanges?: (thread: T) => boolean
}): { working: number; changed: number } {
  const none = { working: 0, changed: 0 }
  if (input.resolution.source !== 'default' || input.resolution.mode !== 'current' || input.worktreeUnavailable)
    return none
  const here = input.threads.filter(
    (thread) => thread.projectId === input.projectId && thread.mode === 'current' && thread.status !== 'archived',
  )
  const working = here.filter((thread) => thread.status === 'running').length
  const changed = here.filter((thread) => thread.status !== 'running' && input.leftChanges?.(thread)).length
  return { working, changed }
}

/** The line New thread shows about the others in its checkout, or null when there are none. */
export function checkoutBusyNote(busy: { working: number; changed: number }): {
  text: string
  values?: Record<string, number>
} | null {
  if (busy.working === 1) return { text: 'Another thread is working in this checkout.' }
  if (busy.working > 1) return { text: '{0} threads are working in this checkout.', values: { 0: busy.working } }
  if (busy.changed === 1) return { text: 'Another thread left uncommitted changes in this checkout.' }
  if (busy.changed > 1)
    return { text: '{0} threads left uncommitted changes in this checkout.', values: { 0: busy.changed } }
  return null
}
