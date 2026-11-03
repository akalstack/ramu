// The small tags a model picker shows beside a model's name, from what the host knows about it.
import type { AgentModel } from '../types'

const DAY = 24 * 60 * 60_000
/** How long a model counts as new after its release. */
export const NEW_FOR_DAYS = 14
/** How far ahead an announced retirement is worth mentioning. */
export const RETIRING_WITHIN_DAYS = 90

export interface ModelTags {
  legacy: boolean
  /** Released within the last two weeks. */
  isNew: boolean
  /** The retirement date, when it is near. */
  retires: string | null
}

export function modelTags(
  model: Pick<AgentModel, 'isLegacy' | 'releasedAt' | 'retiresAt'>,
  now = Date.now(),
): ModelTags {
  const released = model.releasedAt ? Date.parse(model.releasedAt) : NaN
  const retires = model.retiresAt ? Date.parse(model.retiresAt) : NaN
  return {
    legacy: !!model.isLegacy,
    isNew: !model.isLegacy && released <= now && now - released < NEW_FOR_DAYS * DAY,
    retires: retires > now && retires - now < RETIRING_WITHIN_DAYS * DAY ? model.retiresAt! : null,
  }
}
