// Which background alerts this phone asks its hosts to send. No React Native in here, so it is unit tested.

/**
 * `input`: a thread needs you. `failed` / `done`: an ordinary thread stopped with an error or finished.
 * `scheduled`: a thread started by a schedule finished or failed, or a scheduled run could not start (needing input still
 * counts as `input`). `digest`: the once-a-day "your recap is ready" note, with no content.
 */
export const PUSH_CATEGORIES = ['input', 'failed', 'done', 'scheduled', 'digest'] as const
export type PushCategory = (typeof PUSH_CATEGORIES)[number]

/** Off until switched on; every other category is on until switched off. */
export const PUSH_OPT_IN: readonly PushCategory[] = ['digest']
const onByDefault = (category: PushCategory) => !PUSH_OPT_IN.includes(category)

/**
 * The draft key that stores the categories switched away from their default, as a comma list: an on-by-default one that was
 * switched off, or an opt-in one that was switched on. (The key keeps its first name, "muted", so saved choices carry over.)
 */
export const PUSH_MUTED_KEY = 'push-muted'

export function parseSwitched(text: string | undefined): PushCategory[] {
  const listed = (text ?? '').split(',')
  return PUSH_CATEGORIES.filter((category) => listed.includes(category))
}

export function isCategoryOn(text: string | undefined, category: PushCategory): boolean {
  return onByDefault(category) !== parseSwitched(text).includes(category)
}

/** The stored text after switching `category` on or off. */
export function withCategory(text: string | undefined, category: PushCategory, on: boolean): string {
  const switched = parseSwitched(text).filter((entry) => entry !== category)
  return (on === onByDefault(category) ? switched : [...switched, category]).join(',')
}

/**
 * The extra argument for `notifications.register`: the categories that are on, or nothing while every choice is at its
 * default, so a host that learns a new category later still sends it.
 */
export function registerCategories(text: string | undefined): [PushCategory[]] | [] {
  return parseSwitched(text).length ? [PUSH_CATEGORIES.filter((category) => isCategoryOn(text, category))] : []
}
