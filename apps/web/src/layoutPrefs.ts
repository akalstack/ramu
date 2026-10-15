import { useCallback, useSyncExternalStore } from 'react'

// Per-workspace layout choices that stay on this machine, like the dragged split sizes.
const listeners = new Set<() => void>()
const key = (name: string, id: string) => `ramu.layout.${name}.${id}`

export function useLayoutPref<T extends string>(
  name: string,
  id: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => {
      const saved = localStorage.getItem(key(name, id))
      return allowed.includes(saved as T) ? (saved as T) : fallback
    },
  )
  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key(name, id), next)
      listeners.forEach((listener) => listener())
    },
    [name, id],
  )
  return [value, set]
}

/** Reveal a workspace's chat pane from outside its view, e.g. when a chat is opened from the sidebar. */
export function showChat(id: string): void {
  if (localStorage.getItem(key('chat', id)) !== 'hidden') return
  localStorage.setItem(key('chat', id), 'shown')
  listeners.forEach((listener) => listener())
}

export const useEditorSide = (id: string) =>
  useLayoutPref<'left' | 'right'>('editor-side', id, 'right', ['left', 'right'])
export const useChatHidden = (id: string) => {
  const [value, set] = useLayoutPref<'shown' | 'hidden'>('chat', id, 'shown', ['shown', 'hidden'])
  return [value === 'hidden', (hidden: boolean) => set(hidden ? 'hidden' : 'shown')] as const
}
