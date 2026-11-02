import { useState } from 'react'
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native'

/**
 * The width the sheet gives its React Native content. Hosted content is first laid out before the
 * sheet reports its size, and text measured then stays on one unwrapped line; a definite width wraps
 * it. Starts at the window width (a phone sheet's width) and follows the host once it lays out.
 */
export function useHostedWidth() {
  const window = useWindowDimensions().width
  const [measured, setMeasured] = useState<number>()
  return {
    value: measured ?? window,
    onLayout: (event: LayoutChangeEvent) => {
      const next = Math.round(event.nativeEvent.layout.width)
      if (next > 0) setMeasured((current) => (current === next ? current : next))
    },
  }
}
