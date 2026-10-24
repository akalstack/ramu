import { Text } from 'react-native'
import type { ReferenceChip } from '@ramu/shared/chat/referenceChip'
import { REFERENCE_APPEARANCE } from '@ramu/shared/chat/presentation'
import { useTheme } from '../theme'

/** Native inline counterpart of desktop ReferenceChipView: accent text, no pill, inherited type and full link label. */
export function ReferenceBadge({ chip, onPress }: { chip: ReferenceChip; onPress?: () => void }) {
  const { c } = useTheme()
  return (
    <Text
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={chip.title}
      suppressHighlighting
      style={{ color: c.accent, fontWeight: REFERENCE_APPEARANCE.fontWeight }}
    >
      {REFERENCE_APPEARANCE.glyph[chip.kind]}
      {chip.label}
    </Text>
  )
}
