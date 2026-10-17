import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Host, ModalBottomSheet, RNHostView, type ModalBottomSheetRef } from '@expo/ui/jetpack-compose'
import { useTheme } from '../theme'

/**
 * Android's official Material 3 modal bottom sheet (Jetpack Compose), hosting our React Native content. It has an opaque
 * surface, the standard drag handle, scrim, swipe-to-dismiss and back-button handling, so no sheet is see-through.
 */
export function MaterialSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { c, scheme } = useTheme()
  const { height } = useWindowDimensions()
  const sheet = useRef<ModalBottomSheetRef>(null)
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
    else if (mounted) {
      // Slide away first; unmount once the dismiss animation has finished.
      const done = () => setMounted(false)
      if (sheet.current) sheet.current.hide().then(done, done)
      else done()
    }
  }, [open])
  if (!mounted) return null
  return (
    <Host colorScheme={scheme} style={{ position: 'absolute', width: 0, height: 0 }}>
      <ModalBottomSheet
        ref={sheet}
        onDismissRequest={onClose}
        containerColor={c.raised2}
        contentColor={c.text}
        scrimColor="rgba(0,0,0,0.32)"
        skipPartiallyExpanded
      >
        <RNHostView matchContents={{ vertical: true }}>
          <View style={{ maxHeight: height * 0.72 }}>{children}</View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  )
}
