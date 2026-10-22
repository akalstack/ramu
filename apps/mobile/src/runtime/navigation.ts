import type { useRouter } from 'expo-router'

/** Deep links and completed actions may have no previous screen in this navigator. */
export function goBackOrHome(router: Pick<ReturnType<typeof useRouter>, 'canGoBack' | 'back' | 'replace'>): void {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}
