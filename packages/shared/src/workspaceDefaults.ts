import type { CheckoutMode } from './types/workspace'

export type BranchNamingStrategy = 'fixed' | 'semantic' | 'custom'
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
