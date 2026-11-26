import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, CircleAlert, X } from 'lucide-react-native'
import { Keyboard, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, radius, space, useTheme } from '../theme'
import { useT, type Strings } from '../i18n'
import { ERROR_TOAST_MS, TOAST_MS, currentToast, dismissToast, subscribeToast } from '../runtime/toast'
import { Glass } from './Glass'
import { T, tap } from './ui'

/** Where a notice sits so it clears the screen header, and the keyboard and composer below. */
export const belowHeader = (topInset: number) => topInset + (Platform.OS === 'ios' ? 52 : 56 + space.s)

/** How far the keyboard reaches up the screen, so a message near the bottom can sit above it. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setHeight(event.endCoordinates.height),
    )
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setHeight(0),
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}

/**
 * The answer to something you did, where your thumb is, as the desktop shows it in one corner: "Marked done · Undo",
 * "Saved", or what failed. Every kind sits near the bottom, above the keyboard when it is open, and can be closed; an
 * error carries its mark and stays longer. News from agents comes from the top instead (`NoticeBanner`).
 */
export function UndoToast() {
  const { c } = useTheme()
  const t = useT()
  const insets = useSafeAreaInsets()
  const toast = useSyncExternalStore(subscribeToast, currentToast)
  const id = toast?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(() => dismissToast(id), toast?.error ? ERROR_TOAST_MS : TOAST_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per toast; its kind is fixed for its id
  }, [id])
  const keyboard = useKeyboardHeight()
  if (!toast) return null
  // A copy key, or text that is already written (an error from the host).
  const word = (key: string) => (t[key as keyof Strings] as string | undefined) ?? key
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        zIndex: 100,
        left: space.m,
        right: space.m,
        bottom: keyboard ? keyboard + space.s : insets.bottom + 72,
      }}
    >
      <Glass floating radius={radius.l}>
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.s }}
        >
          {toast.error ? (
            <CircleAlert size={16} color={c.bad} style={{ marginRight: space.s }} />
          ) : toast.success ? (
            <Check size={16} color={c.ok} style={{ marginRight: space.s }} />
          ) : null}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={word('dismiss')}
            hitSlop={8}
            onPress={() => dismissToast(toast.id)}
            style={{ height: 40, width: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={15} color={c.muted} />
          </Pressable>
        </View>
      </Glass>
    </View>
  )
}
