import { Text, View } from 'react-native'
import { FileText, Folder, Quote, SquareTerminal, Users, WandSparkles } from 'lucide-react-native'
import type { ReferenceChip } from '@ramu/shared/chat/referenceChip'
import { REFERENCE_APPEARANCE } from '@ramu/shared/chat/presentation'
import { useTheme } from '../theme'
import type { Icon } from './ui'
import { FileIcon } from './FileIcon'
import { ProviderIcon } from './Logos'
import { localFileLink } from '@ramu/shared/workspace/fileLinks'

/** The same icon per kind as the desktop chip. Text symbols such as ▤ are missing from some phone fonts and draw as boxes. */
const KIND_ICON: Record<ReferenceChip['kind'], Icon> = {
  file: FileText,
  folder: Folder,
  skill: WandSparkles,
  command: SquareTerminal,
  quote: Quote,
  mention: Users,
}

/** Native inline counterpart of desktop ReferenceChipView: accent text with its icon, no pill, and the full link label. */
export function ReferenceBadge({ chip, onPress }: { chip: ReferenceChip; onPress?: () => void }) {
  const { c } = useTheme()
  const I = KIND_ICON[chip.kind]
  return (
    <Text
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={chip.title}
      suppressHighlighting
      style={{ color: c.accent, fontWeight: REFERENCE_APPEARANCE.fontWeight }}
    >
      <View style={{ paddingRight: REFERENCE_APPEARANCE.gap, transform: [{ translateY: 2 }] }}>
        {chip.kind === 'file' ? (
          <FileIcon path={(chip.target && localFileLink(chip.target)?.path) || chip.label} size={13} />
        ) : chip.kind === 'mention' && chip.provider ? (
          <ProviderIcon provider={chip.provider} size={13} />
        ) : (
          <I size={13} color={c.accent} strokeWidth={2} />
        )}
      </View>
      {chip.label}
    </Text>
  )
}
