// What a helper the agent starts with `ramu_agent` is for. Research and review read and report; they never edit.

export const HELPER_ROLES = ['implementation', 'research', 'review', 'test'] as const
export type HelperRole = (typeof HELPER_ROLES)[number]

export function helperRoleReadOnly(role: HelperRole | undefined): boolean {
  return role === 'research' || role === 'review'
}

const BRIEFS: Record<HelperRole, string> = {
  implementation: 'Your role is implementation: make the change, check it works, and report what you changed.',
  research:
    'Your role is research: read code, docs and anything else you can reach, then report what you found with sources. You are read-only: never edit files.',
  review:
    'Your role is review: read the changes and report real, specific problems, most serious first, with file and line. You are read-only: never edit files.',
  test: 'Your role is testing: add or update focused tests and run them until they pass. Change the code under test only when a test proves it wrong, and say so.',
}

export function helperRoleBrief(role: HelperRole): string {
  return BRIEFS[role]
}
