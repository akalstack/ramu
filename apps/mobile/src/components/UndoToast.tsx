import { useEffect, useSyncExternalStore } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, radius, space, useTheme } from '../theme'
import { useT, type Strings } from '../i18n'
import { TOAST_MS, currentToast, dismissToast, subscribeToast } from '../runtime/toast'
import { Glass, floatingChrome } from './Glass'
import { T, tap } from './ui'

/** One short message near the bottom with a button, like "Marked done · Undo". It leaves by itself after a few seconds. */
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
  const word = (key: string) => t[key as keyof Strings] as string
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', zIndex: 100, left: space.m, right: space.m, bottom: insets.bottom + 72 }}
    >
      <Glass radius={radius.l} style={{ backgroundColor: floatingChrome ? undefined : c.raised }}>
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.s }}
        >
          <T size={font.control} weight="500" style={{ flex: 1, paddingVertical: space.m }}>
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
