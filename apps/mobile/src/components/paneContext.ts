import { createContext, use, useCallback } from 'react'
import { useRouter } from 'expo-router'
import { threadRoute, type ThreadOrigin as Origin } from '../runtime/splitLayout'

/** Rows in the list beside an open thread open threads in place, and the open one is marked. */
export const ThreadPicker = createContext<{ openId: string; open(id: string): void } | null>(null)
/** A screen drawn in the pane beside the list draws its own header, since the native bar would span both panes. */
export const DetailPane = createContext(false)
/**
 * The list a thread is opened from. On a wide window the thread shows beside that same list, so a thread opened from
 * the Inbox keeps the Inbox beside it rather than switching to the thread list.
 */
export const ThreadOrigin = createContext<Origin>('threads')

export const useThreadPicker = () => use(ThreadPicker)
export const useInDetailPane = () => use(DetailPane)

/** Opens a thread in place beside the list it was picked from, or as its own screen remembering that list. */
export function useOpenThread() {
  const router = useRouter()
  const picker = use(ThreadPicker)
  const origin = use(ThreadOrigin)
  return useCallback(
    (id: string) => {
      if (picker) return picker.open(id)
      router.push(threadRoute(id, origin))
    },
    [picker, origin, router],
  )
}
