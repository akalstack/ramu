import type { InteractiveReference } from './interactive'
/** Browsing never replaces the reference in the historical turn, even when the host returns newer metadata. */
export function interactiveVersions(
  original: InteractiveReference,
  references: InteractiveReference[],
): InteractiveReference[] {
  const versions = new Map<number, InteractiveReference>()
  for (const ref of references)
    if (ref.id === original.id && ref.sessionId === original.sessionId) versions.set(ref.version, ref)
  versions.set(original.version, original)
  return [...versions.values()].sort((a, b) => b.version - a.version)
}

/** Only explicitly declared identical schemas permit a user-requested copy; there is no inferred migration. */
export function canCopyInteractiveState(from: InteractiveReference, to: InteractiveReference): boolean {
  return (
    from.id === to.id &&
    from.sessionId === to.sessionId &&
    from.version !== to.version &&
    typeof from.stateSchema === 'string' &&
    from.stateSchema.trim().length > 0 &&
    from.stateSchema === to.stateSchema
  )
}
