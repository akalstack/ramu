import type { useRouter } from 'expo-router'

/** Deep links and completed actions may have no previous screen in this navigator. */
export function goBackOrHome(router: Pick<ReturnType<typeof useRouter>, 'canGoBack' | 'back' | 'replace'>): void {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

type NavigationRoute = { key?: string; state?: NavigationNode }
type NavigationNode = { index?: number; routes: readonly NavigationRoute[] }

/** Each mounted screen's title by route key, written by its header, so a back menu can name the screens it returns to. */
export const screenTitles = new Map<string, string>()

/** A route that holds its own navigator (the tabs) is named by the screen showing inside it. */
function shownTitle(route: NavigationRoute, titles: ReadonlyMap<string, string>): string | undefined {
  const inner = route.state?.routes[route.state.index ?? route.state.routes.length - 1]
  return (inner && shownTitle(inner, titles)) ?? (route.key === undefined ? undefined : titles.get(route.key))
}

/**
 * The screens Back can return to in one step, nearest first, as the iOS back button's long-press menu lists them.
 * `count` is how many screens to close to reach each one; screens with no title are left out of the list only.
 */
export function backHistory(
  state: NavigationNode,
  titles: ReadonlyMap<string, string> = screenTitles,
): { label: string; count: number }[] {
  const current = state.index ?? state.routes.length - 1
  const entries: { label: string; count: number }[] = []
  for (let index = current - 1; index >= 0; index--) {
    const label = shownTitle(state.routes[index]!, titles)
    if (label) entries.push({ label, count: current - index })
  }
  return entries
}
