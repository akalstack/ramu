import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Plus, X } from 'lucide-react-native'
import type { TerminalInfo } from '@ramu/shared/api'
import { font, radius, useTheme } from '../theme'
import { T } from './ui'

/** One tab per shell in this workspace, scrolling sideways like the desktop's terminal tabs and Termius. */
export function TerminalTabs({
  tabs,
  active,
  busy,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: TerminalInfo[]
  active: number
  busy?: boolean
  onSelect(index: number): void
  onClose(tab: TerminalInfo): void
  onNew(): void
}) {
  const { c } = useTheme()
  const scroll = useRef<ScrollView>(null)
  const frames = useRef(new Map<string, { x: number; width: number }>())
  const viewport = useRef(0)
  // Keep the active tab in view when it changes or a new shell opens.
  useEffect(() => {
    const frame = frames.current.get(tabs[active]?.id ?? '')
    if (frame)
      scroll.current?.scrollTo({ x: Math.max(0, frame.x + frame.width / 2 - viewport.current / 2), animated: true })
  }, [active, tabs.length])
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 6, gap: 6 }}
      onLayout={(event) => {
        viewport.current = event.nativeEvent.layout.width
      }}
    >
      {tabs.map((tab, index) => {
        const selected = index === active
        return (
          <View
            key={tab.id}
            onLayout={(event) =>
              frames.current.set(tab.id, { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              height: 34,
              borderRadius: radius.full,
              backgroundColor: selected ? c.accentWash : c.fill,
            }}
          >
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`Shell ${index + 1}${tab.exited ? ', ended' : ''}`}
              onPress={() => onSelect(index)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 12,
                paddingRight: selected ? 4 : 12,
                height: 34,
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tab.exited ? c.muted : c.ok }} />
              <T
                size={font.control}
                weight={selected ? '600' : '500'}
                tone={selected ? 'text' : 'soft'}
                numberOfLines={1}
              >
                {tab.exited ? `Shell ${index + 1} · ended` : `Shell ${index + 1}`}
              </T>
            </Pressable>
            {selected ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close shell ${index + 1}`}
                hitSlop={6}
                onPress={() => onClose(tab)}
                style={{ width: 30, height: 34, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} color={c.muted} />
              </Pressable>
            ) : null}
          </View>
        )
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New terminal"
        disabled={busy}
        onPress={onNew}
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.fill,
          opacity: busy ? 0.4 : 1,
        }}
      >
        <Plus size={16} color={c.soft} />
      </Pressable>
    </ScrollView>
  )
}
