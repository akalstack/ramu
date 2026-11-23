import type { ComponentType, ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { font, radius, space, useTheme } from '../theme'
import { useT } from '../i18n'
import { Chip, SectionLabel, T } from './ui'

/** A row of filter chips with counts, as at the top of Home and Inbox. */
export function Chips<K extends string>({
  value,
  onChange,
  options,
  lead,
}: {
  value: K
  onChange: (key: K) => void
  options: { key: K; label: string; count?: number }[]
  /** A control before the chips, such as the host chip. */
  lead?: ReactNode
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s }}
    >
      {lead}
      {options.map((option) => (
        <Chip
          key={option.key}
          label={option.label}
          count={option.count}
          selected={option.key === value}
          onPress={() => onChange(option.key)}
        />
      ))}
    </ScrollView>
  )
}

/** A titled block with an optional "See all" that jumps to the tab holding the rest. */
export function Section({
  title,
  count,
  onSeeAll,
  children,
}: {
  title: string
  count?: number
  onSeeAll?: () => void
  children: ReactNode
}) {
  const t = useT()
  return (
    <View>
      <SectionLabel
        right={
          onSeeAll ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={onSeeAll}>
              <T size={font.caption} weight="600" tone="accent">
                {`${t.seeAll}${count ? ` · ${count}` : ''}`}
              </T>
            </Pressable>
          ) : count ? (
            <T size={font.caption} tone="muted">
              {count}
            </T>
          ) : undefined
        }
      >
        {title}
      </SectionLabel>
      {children}
    </View>
  )
}

/** Rows stacked inside one rounded group on the raised surface. */
/** `flush` drops the side margin, for a group that already sits inside padded content. */
export function Group({ children, flush }: { children: ReactNode; flush?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        marginHorizontal: flush ? 0 : space.l,
        backgroundColor: c.raised2,
        borderRadius: radius.l,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  )
}

export function Nothing({
  icon: I,
  title,
  detail,
}: {
  icon: ComponentType<{ size?: number; color?: string }>
  title: string
  detail: string
}) {
  const { c } = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xl * 2, paddingHorizontal: space.xl, gap: space.s }}>
      <I size={28} color={c.placeholder} />
      <T weight="600" style={{ textAlign: 'center' }}>
        {title}
      </T>
      <T tone="muted" size={font.control} style={{ textAlign: 'center', lineHeight: 19 }}>
        {detail}
      </T>
    </View>
  )
}
