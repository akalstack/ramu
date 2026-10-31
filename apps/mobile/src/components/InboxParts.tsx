import { useState, type ComponentType, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Check, Clock, Folder, X } from 'lucide-react-native'
import type { RecapItem } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { useT } from '../i18n'
import { SNOOZE_MENU, snoozeEnds } from '../runtime/recapActions'
import { Chip, SectionLabel, Sheet, T, tap } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'
import { SwipeRow, type SwipeAction } from './SwipeRow'

/** A row of filter chips with counts, as at the top of Home and Inbox. */
export function Chips<K extends string>({
  value,
  onChange,
  options,
}: {
  value: K
  onChange: (key: K) => void
  options: { key: K; label: string; count?: number }[]
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s }}
    >
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

/**
 * One recap item: the project, what happened, and what you can do about it. Swipe left for Done, Snooze and Dismiss (an
 * item that needs a decision) or Dismiss alone; Snooze asks how long. Each action is followed by an Undo toast.
 */
export function RecapCard({
  item,
  project,
  attention,
  choices = true,
  onOpen,
  onAct,
}: {
  item: RecapItem
  project?: string
  attention: boolean
  /** The host takes a chosen snooze time. When it does not, Snooze is the plain one-day button and has no menu. */
  choices?: boolean
  onOpen: () => void
  onAct: (action: 'done' | 'dismissed' | 'snoozed', until?: number) => Promise<void>
}) {
  const { c } = useTheme()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const act = (action: 'done' | 'dismissed' | 'snoozed', until?: number) => {
    tap()
    setBusy(true)
    // The card disappears as soon as the item changes, so there is nothing to reset on success.
    onAct(action, until).catch(() => setBusy(false))
  }
  const snooze = () => {
    tap()
    if (choices) setMenu(true)
    else act('snoozed')
  }
  const button = (label: string, run: () => void, primary = false, icon?: ReactNode) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={run}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 32,
        paddingHorizontal: space.m,
        borderRadius: radius.full,
        backgroundColor: pressed ? c.pressed : primary ? c.fill : 'transparent',
        opacity: busy ? 0.5 : 1,
      })}
    >
      {icon}
      <T size={font.control} weight={primary ? '600' : '500'} tone={primary ? 'text' : 'muted'}>
        {label}
      </T>
    </Pressable>
  )
  // The amber wash is translucent, so it sits over the opaque card colour; on its own, a swiped row showed its buttons through.
  const tint = attention ? c.warnWash : undefined
  const swipe: SwipeAction[] = busy
    ? []
    : [
        ...(attention
          ? [
              { icon: Check, label: t.markDone, color: c.primary, onPress: () => act('done') },
              { icon: Clock, label: t.snooze, color: c.warn, onPress: snooze },
            ]
          : []),
        { icon: X, label: t.dismiss, color: c.muted, onPress: () => act('dismissed') },
      ]
  return (
    <View style={{ marginHorizontal: space.l, marginBottom: space.s, borderRadius: radius.l, overflow: 'hidden' }}>
      <SwipeRow actions={swipe} background={c.raised2}>
        <View style={{ padding: space.l, gap: 6, backgroundColor: tint }}>
          {project ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Folder size={12} color={c.muted} />
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {project}
              </T>
            </View>
          ) : null}
          <T weight="600">{item.title}</T>
          {item.detail ? (
            <T tone="soft" size={font.control} numberOfLines={4} style={{ lineHeight: 19 }}>
              {item.detail}
            </T>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 4,
              marginLeft: -space.s,
            }}
          >
            {button(t.openThread, onOpen, true)}
            {attention ? button(t.markDone, () => act('done'), false, <Check size={13} color={c.muted} />) : null}
            {attention ? button(choices ? t.snooze : t.snoozeDay, snooze) : null}
            {button(t.dismiss, () => act('dismissed'))}
          </View>
        </View>
      </SwipeRow>
      <Sheet open={menu} onClose={() => setMenu(false)} title={t.snooze}>
        <SheetGroup>
          {SNOOZE_MENU.map(({ choice, label }) => (
            <SheetOption
              key={choice}
              icon={Clock}
              title={t[label]}
              onPress={() => {
                setMenu(false)
                act('snoozed', snoozeEnds(choice))
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </View>
  )
}
