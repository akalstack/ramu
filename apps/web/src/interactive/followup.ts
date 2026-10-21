import type { InteractiveAttachment } from '@ramu/shared/interactive'

/** A card asks its thread's composer to attach Interactive Content to the next message. */
export const INTERACTIVE_FOLLOWUP_EVENT = 'ramu:interactive-followup'

export interface InteractiveFollowupDetail {
  host: string
  session: string
  attachment: InteractiveAttachment
}

/** Adds an attachment, replacing an earlier capture of the same version so the newest scenario wins. */
export function addInteractiveAttachment(
  current: InteractiveAttachment[],
  next: InteractiveAttachment,
): InteractiveAttachment[] {
  return [...current.filter((item) => item.id !== next.id || item.version !== next.version), next]
}
