import { useCallback, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { READABLE_WIDTH, readableGutter, withGutter } from '../runtime/readableColumn'

/**
 * Centers a vertical scroll view's content in the readable column. It follows the scroll view's own width, not the
 * window's, so a form sheet or a split-screen half on a tablet gets the column its width allows. The window width is the
 * first guess, which is right for full-screen pages.
 */
export function useReadableColumn(enabled = true) {
  const window = useWindowDimensions().width
  const [measured, setMeasured] = useState<number>()
  const gutter = enabled ? readableGutter(measured ?? window) : 0
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width)
    if (next > 0) setMeasured((current) => (current === next ? current : next))
  }, [])
  const contentContainerStyle = useCallback(
    (style: StyleProp<ViewStyle>): StyleProp<ViewStyle> =>
      gutter ? [style, withGutter(StyleSheet.flatten(style), gutter)] : style,
    [gutter],
  )
  return { gutter, onLayout, contentContainerStyle }
}

/** Chrome laid over a page (a docked composer, a selection bar) lined up with the readable column beneath it. */
export function ReadableColumn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }, style]}>{children}</View>
}

/** A vertical ScrollView whose content keeps to the readable column; for pages that need a plain ScrollView. */
export function ReadableScrollView({
  ref,
  onLayout,
  contentContainerStyle,
  ...props
}: ComponentProps<typeof ScrollView> & { ref?: Ref<import('react-native').ScrollViewInstance> }) {
  const column = useReadableColumn(!props.horizontal)
  return (
    <ScrollView
      {...props}
      ref={ref}
      contentContainerStyle={column.contentContainerStyle(contentContainerStyle)}
      onLayout={(event) => {
        column.onLayout(event)
        onLayout?.(event)
      }}
    />
  )
}
