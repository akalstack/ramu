import { useEffect, useSyncExternalStore } from 'react'
import { CircleAlert } from 'lucide-react-native'
import { Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, radius, space, useTheme } from '../theme'
import { useT, type Strings } from '../i18n'
import { TOAST_MS, currentToast, dismissToast, subscribeToast } from '../runtime/toast'
import { Glass, floatingChrome } from './Glass'
import { T, tap } from './ui'

/** Where a notice sits so it clears the screen header, and the keyboard and composer below. */
export const belowHeader = (topInset: number) => topInset + (Platform.OS === 'ios' ? 52 : 56 + space.s)

/**
 * One short message that leaves by itself after a few seconds. A notice with a button, like "Marked done · Undo", stays
 * near the bottom within reach; an error reads under the header, where the keyboard and composer cannot cover it.
 */
export function UndoToast() {
  const { c } = useTheme()
  const t = useT()
  const insets = useSafeAreaInsets()
  const toast = useSyncExternalStore(subscribeToast, currentToast)
  const id = toast?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(() => dismissToast(id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [id])
  if (!toast) return null
  // A copy key, or text that is already written (an error from the host).
  const word = (key: string) => (t[key as keyof Strings] as string | undefined) ?? key
  return (
    <View
      // An error has nothing to press, so it never blocks what sits under it.
      pointerEvents={toast.error ? 'none' : 'box-none'}
      style={{
        position: 'absolute',
        zIndex: 100,
        left: space.m,
        right: space.m,
        ...(toast.error ? { top: belowHeader(insets.top) } : { bottom: insets.bottom + 72 }),
      }}
    >
      <Glass radius={radius.l} style={{ backgroundColor: floatingChrome ? undefined : c.raised }}>
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.s }}
        >
          {toast.error ? <CircleAlert size={16} color={c.bad} style={{ marginRight: space.s }} /> : null}
          <T
            size={font.control}
            weight="500"
            numberOfLines={toast.error ? 3 : undefined}
            style={{ flex: 1, paddingVertical: space.m }}
          >
            {word(toast.message)}
          </T>
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                tap()
                const { run } = toast.action!
                dismissToast(toast.id)
                run()
              }}
              style={{ height: 40, paddingHorizontal: space.m, justifyContent: 'center' }}
            >
              <T size={font.control} weight="600" tone="accent">
                {word(toast.action.label)}
              </T>
            </Pressable>
          ) : null}
        </View>
      </Glass>
    </View>
  )
}
