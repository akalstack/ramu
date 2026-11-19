import type { ManagedSkill } from './types'

export type SkillAction = 'pin' | 'unpin' | 'disable' | 'archive' | 'restore'

/** English copy keys for each action, translated where they are drawn. */
export const SKILL_ACTION_LABELS: Record<SkillAction, string> = {
  pin: 'Pin',
  unpin: 'Unpin',
  disable: 'Disable',
  archive: 'Archive',
  restore: 'Restore',
}

/** What `learning.control` can do to a managed skill now: pin or unpin it, and turn off or archive it, or bring it back. */
export function skillActions(skill: Pick<ManagedSkill, 'pinned' | 'status'>): SkillAction[] {
  return [
    skill.pinned ? 'unpin' : 'pin',
    ...(skill.status === 'active' ? (['disable', 'archive'] as const) : (['restore'] as const)),
  ]
}
