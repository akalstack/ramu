// Auto's "Choose a project" list survives a restart with the draft it was asked for. It is stored per host next to the
// draft and only restored for the exact prompt and while its projects still exist; restoring never creates work, the
// person still chooses and the destination is revalidated when they do.
export interface RouteCandidate {
  projectId: string
  reason: string
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY = 'ramu.route-choice.new'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_CANDIDATES = 100

export function saveRouteChoice(
  store: Store | null,
  prompt: string,
  candidates: readonly RouteCandidate[] | null,
  now = Date.now(),
): void {
  try {
    if (!store) return
    if (!candidates?.length || !prompt.trim()) store.removeItem(KEY)
    else
      store.setItem(
        KEY,
        JSON.stringify({ version: 1, prompt, at: now, candidates: candidates.slice(0, MAX_CANDIDATES) }),
      )
  } catch {}
}

export function loadRouteChoice(
  store: Store | null,
  prompt: string,
  eligible: readonly string[],
  now = Date.now(),
): RouteCandidate[] | null {
  try {
    const raw = store?.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { version?: unknown; prompt?: unknown; at?: unknown; candidates?: unknown }
    if (
      data.version !== 1 ||
      data.prompt !== prompt ||
      typeof data.at !== 'number' ||
      now - data.at > MAX_AGE_MS ||
      !Array.isArray(data.candidates)
    ) {
      store?.removeItem(KEY)
      return null
    }
    const candidates = data.candidates.filter(
      (c): c is RouteCandidate =>
        !!c &&
        typeof c.projectId === 'string' &&
        eligible.includes(c.projectId) &&
        typeof c.reason === 'string' &&
        c.reason.length <= 1000,
    )
    return candidates.length ? candidates : null
  } catch {
    return null
  }
}
