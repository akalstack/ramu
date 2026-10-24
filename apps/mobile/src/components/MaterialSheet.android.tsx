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
  const [generation, setGeneration] = useState(0)
  const revision = useRef(0)
  const hiding = useRef(false)
  const visible = useRef(open)
  visible.current = open
  useEffect(() => {
    let active = true
    if (open) {
      // A native hide already in flight cannot be undone by keeping the same view mounted.
      // Replace that view and ignore its completion/dismiss callbacks.
      if (hiding.current) {
        hiding.current = false
        setGeneration(++revision.current)
      }
      setMounted(true)
    } else if (mounted) {
      hiding.current = true
      // Slide away first; unmount once the dismiss animation has finished.
      const done = () => {
        if (active && !visible.current) setMounted(false)
      }
      if (sheet.current) sheet.current.hide().then(done, done)
      else done()
    }
    return () => {
      active = false
    }
  }, [open, mounted])
  if (!mounted) return null
  return (
    <Host colorScheme={scheme} style={{ position: 'absolute', width: 0, height: 0 }}>
      <ModalBottomSheet
        key={generation}
        ref={sheet}
        onDismissRequest={() => {
          if (visible.current && generation === revision.current) onClose()
        }}
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
