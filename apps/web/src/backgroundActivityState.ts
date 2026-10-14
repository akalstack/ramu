import type { BackgroundActivity } from '@ramu/shared/activity'

/** An unavailable activity endpoint does not mean the service disconnected. */
export async function readBackgroundActivity(
  readActivity: () => Promise<BackgroundActivity[]>,
  readService: () => Promise<{ running: boolean }>,
): Promise<{ activities: BackgroundActivity[]; connected: boolean }> {
  try { return { activities: await readActivity(), connected: true } }
  catch {
    try { return { activities: [], connected: (await readService()).running } }
    catch { return { activities: [], connected: false } }
  }
}
