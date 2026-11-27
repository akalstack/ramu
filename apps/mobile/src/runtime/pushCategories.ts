// Which background alerts this phone asks its hosts to send. No React Native in here, so it is unit tested.

/**
 * `input`: a thread needs you. `failed` / `done`: an ordinary thread stopped with an error or finished.
 * `scheduled`: a thread started by a schedule finished or failed, or a scheduled run could not start (needing input still
 * counts as `input`). `artifacts`: notifications artifacts you allowed to notify send, in their own words.
 */
export const PUSH_CATEGORIES = ['input', 'failed', 'done', 'scheduled', 'artifacts'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]

/** The draft key that stores the categories switched off, as a comma list. Every category is on until switched off. */
export const PUSH_MUTED_KEY = 'push-muted'

export function parseSwitched(text: string | undefined): PushCategory[] {
  const listed = (text ?? '').split(',')
  return PUSH_CATEGORIES.filter((category) => listed.includes(category))
}

export function isCategoryOn(text: string | undefined, category: PushCategory): boolean {
  return !parseSwitched(text).includes(category)
}

/** The stored text after switching `category` on or off. */
export function withCategory(text: string | undefined, category: PushCategory, on: boolean): string {
  const switched = parseSwitched(text).filter((entry) => entry !== category)
  return (on ? switched : [...switched, category]).join(',')
}

/**
 * The extra argument for `notifications.register`: the categories that are on, or nothing while none is switched off,
 * so a host that learns a new category later still sends it.
 */
export function registerCategories(text: string | undefined): [PushCategory[]] | [] {
  return parseSwitched(text).length ? [PUSH_CATEGORIES.filter((category) => isCategoryOn(text, category))] : []
}
