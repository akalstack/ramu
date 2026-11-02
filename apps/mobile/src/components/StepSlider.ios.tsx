import { useEffect, useRef, useState } from 'react'
import { Host, Slider } from '@expo/ui/swift-ui'
import { tint, accessibilityLabel } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../theme'
import { tap } from './ui'

/**
 * iOS uses the system slider: these sliders live in native sheets, whose own drag gesture takes a React Native pan
 * away mid-drag. Same contract as the other platforms: `onPreview` follows the thumb, `onCommit` fires once when the
 * person lets go.
 */
export function StepSlider({
  count,
  index,
  disabled,
  onPreview,
  onCommit,
  label,
}: {
  count: number
  index: number
  disabled?: boolean
  onPreview?: (index: number) => void
  onCommit: (index: number) => void
  label: string
}) {
  const { c } = useTheme()
  const [value, setValue] = useState(Math.max(0, index))
  const editing = useRef(false)
  const latest = useRef(value)
  useEffect(() => {
    if (!editing.current) {
      setValue(Math.max(0, index))
      latest.current = Math.max(0, index)
    }
  }, [index])
  const last = Math.max(1, count - 1)
  return (
    <Host matchContents={{ vertical: true }} style={{ minHeight: 40, opacity: disabled ? 0.4 : 1 }}>
      <Slider
        value={value}
        min={0}
        max={last}
        step={1}
        modifiers={[tint(c.accent), accessibilityLabel(label)]}
        onValueChange={(next) => {
          if (disabled || count < 2) return
          const step = Math.round(next)
          if (step === latest.current) return
          latest.current = step
          setValue(step)
          onPreview?.(step)
          tap()
        }}
        onEditingChanged={(isEditing) => {
          editing.current = isEditing
          if (isEditing || disabled) return
          if (latest.current !== index) onCommit(latest.current)
        }}
      />
    </Host>
  )
}
