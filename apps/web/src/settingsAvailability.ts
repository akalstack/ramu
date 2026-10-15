import type { SettingsSnapshot } from '@ramu/shared/settingsCompatibility'
import { errorText } from './errors'

export class SettingsUpdateRequired extends Error {}

/** Missing snapshot support means an older service, not a connection failure. */
export async function readSettingsSnapshot(read: () => Promise<SettingsSnapshot>): Promise<SettingsSnapshot> {
  let snapshot: SettingsSnapshot
  try {
    snapshot = await read()
  } catch (error) {
    if (errorText(error) === 'Unknown method settings.app.snapshot') throw new SettingsUpdateRequired()
    throw error
  }
  if (snapshot?.protocol !== 1 || !snapshot.preferences) throw new SettingsUpdateRequired()
  return snapshot
}
