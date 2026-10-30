import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { View } from 'react-native'
import { Check } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { Card, Divider, Row, SectionLabel, T, tap, type Icon } from './ui'

/**
 * A group of options in a sheet, drawn like a Settings group: a small caption, then one raised card with hairlines between
 * the rows. Every sheet of choices or actions builds on this so they separate by shade, not by a flat list on the sheet.
 */
export function SheetGroup({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const rows = flatten(children)
  return (
    <View style={{ paddingTop: title ? 0 : space.m }}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <Card style={{ marginHorizontal: space.l }}>
        {rows.map((row, index) => (
          <View key={isValidElement(row) && row.key != null ? row.key : index}>
            {index ? <Divider inset={space.l} /> : null}
            {row}
          </View>
        ))}
      </Card>
      {footer ? (
        <T
          size={font.caption}
          tone="muted"
          style={{ paddingHorizontal: space.l + 4, paddingTop: space.s, lineHeight: 18 }}
        >
          {footer}
        </T>
      ) : null}
    </View>
  )
}

/** Fragments and nulls from conditional rows must not leave empty slots or stray dividers. */
function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  )
}

/**
 * One option or action: an icon tile, the title, an optional line of help (or the reason it is unavailable) and a check
 * when it is the current choice.
 */
export function SheetOption({
  icon: I,
  title,
  help,
  selected,
  danger,
  disabled,
  trailing,
  onPress,
}: {
  icon?: Icon
  title: string
  help?: string
  selected?: boolean
  danger?: boolean
  disabled?: boolean
  trailing?: ReactNode
  onPress?: () => void
}) {
  const { c } = useTheme()
  return (
    <Row
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={
        onPress
          ? () => {
              tap()
              onPress()
            }
          : undefined
      }
      style={{ minHeight: 52, paddingVertical: space.s + 2, opacity: disabled ? 0.45 : 1 }}
    >
      {I ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.s,
            backgroundColor: danger ? c.badWash : selected ? c.accentSoft : c.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <I size={16} color={danger ? c.bad : selected ? c.accent : c.soft} strokeWidth={1.8} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T weight={selected ? '600' : '500'} tone={danger ? 'bad' : 'text'} numberOfLines={2}>
          {title}
        </T>
        {help ? (
          <T size={font.caption} tone="muted" style={{ lineHeight: 17 }} numberOfLines={3}>
            {help}
          </T>
        ) : null}
      </View>
      {trailing}
      {selected ? <Check size={17} color={c.accent} strokeWidth={2.2} /> : null}
    </Row>
  )
}

/** A group holding one control (a segmented switch, a stepper) rather than option rows. */
export function SheetPanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      <Card
        style={{
          marginHorizontal: space.l,
          padding: space.m,
        }}
      >
        {children}
      </Card>
    </View>
  )
}

/** The text field every sheet form uses: a raised field on the sheet, like the cards around it. */
export function useSheetInputStyle(multiline = false) {
  const { c } = useTheme()
  return {
    color: c.text,
    backgroundColor: c.raised2,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    fontSize: font.body,
    minHeight: multiline ? 96 : 48,
    ...(multiline ? { textAlignVertical: 'top' as const } : {}),
  }
}
