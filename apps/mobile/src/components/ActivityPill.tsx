import { createContext, useContext, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { T, tap, type Icon } from './ui'

/** While a turn runs, quiet pills show only their icon so the working status and anything needing attention fit. */
export const CompactPills = createContext(false)

/**
 * One pill in the row above the composer: computer, browser, terminal and every activity look and behave alike. The
 * icon carries the state (`attention` for something the person or the agent is doing right now), the label stays
 * short, and a tap opens the detail.
 */
export function ActivityPill({
  icon: I,
  label,
  accessibilityLabel,
  tone = 'quiet',
  emphasis = false,
  onPress,
  trailing,
}: {
  icon: Icon
  label: string
  accessibilityLabel?: string
  /** `attention` while the agent acts or the person must answer; `off` while the host is unreachable. */
  tone?: 'quiet' | 'attention' | 'off'
  /** The thread's main activity right now. */
  emphasis?: boolean
  onPress?(): void
  /** A second action inside the pill, such as Stop; replaces the chevron. */
  trailing?: ReactNode
}) {
  const { c } = useTheme()
  const iconOnly = useContext(CompactPills) && tone === 'quiet' && !emphasis
  const color = tone === 'attention' ? c.warn : tone === 'off' ? c.muted : c.soft
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        minHeight: 32,
        borderRadius: radius.full,
        backgroundColor: c.fill,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        disabled={!onPress}
        onPress={() => {
          tap()
          onPress?.()
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 32,
          minWidth: 32,
          justifyContent: 'center',
          paddingLeft: iconOnly ? space.s : space.s + 2,
          paddingRight: trailing ? 0 : space.s,
        }}
      >
        <I size={14} color={color} />
        {iconOnly ? null : (
          <T
            size={font.caption}
            weight={emphasis ? '600' : '500'}
            tone={tone === 'off' ? 'muted' : 'text'}
            numberOfLines={1}
            style={{ maxWidth: 180 }}
          >
            {label}
          </T>
        )}
        {!trailing && onPress && !iconOnly ? <ChevronRight size={12} color={c.muted} /> : null}
      </Pressable>
      {trailing}
    </View>
  )
}
