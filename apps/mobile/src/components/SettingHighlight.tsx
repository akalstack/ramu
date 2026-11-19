import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
} from 'react'
import { View, useWindowDimensions, type ScrollViewInstance } from 'react-native'
import { PageScrollView } from './Screen'
import { Glow } from './Glow'

type Target = {
  /** The setting a search result opened, by its title. */
  title: string
  /** Scrolls the page so a row measured at `y` (window coordinates) with height `height` sits in the middle. */
  reveal(y: number, height: number): void
}

const SettingTarget = createContext<Target | null>(null)

/** The title of the setting a search opened this page for, so a fold holding it opens. */
export const useSettingTargetTitle = () => useContext(SettingTarget)?.title

/**
 * A settings page's scroll view. When a search result opened the page for one setting (`target`, its title), that row
 * scrolls itself to the middle and lights up.
 */
export function SettingScroll({
  target,
  onScroll,
  ...props
}: ComponentProps<typeof PageScrollView> & { target?: string }) {
  const { height } = useWindowDimensions()
  const scroll = useRef<ScrollViewInstance>(null)
  const offset = useRef(0)
  const found = useMemo(
    () =>
      target
        ? {
            title: target,
            reveal: (y: number, rowHeight: number) =>
              scroll.current?.scrollTo({ y: Math.max(0, offset.current + y + rowHeight / 2 - height / 2) }),
          }
        : null,
    [target, height],
  )
  return (
    <SettingTarget.Provider value={found}>
      <PageScrollView
        {...props}
        ref={scroll}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y
          onScroll?.(event)
        }}
      />
    </SettingTarget.Provider>
  )
}

/**
 * One settings row that a search can lead to. When it is the setting searched for, it scrolls itself into the middle of
 * the page and lights up, as the desktop highlights a found setting.
 */
export function SettingHighlight({ title, children }: { title: string; children: ReactNode }) {
  const target = useContext(SettingTarget)
  const ref = useRef<ComponentRef<typeof View>>(null)
  const [pulse, setPulse] = useState<number | null>(null)
  const done = useRef(false)
  const wanted = !!target && target.title === title
  useEffect(() => {
    if (!wanted || done.current) return
    // Rows above may still be laying out (a host's settings arriving); measure once the page has settled.
    const timer = setTimeout(() => {
      done.current = true
      ref.current?.measureInWindow((_x, y, _width, height) => {
        target!.reveal(y, height)
        setPulse(Date.now())
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [wanted, target])
  return (
    <View ref={ref} collapsable={false}>
      {/* Starts after the scroll, so the light is seen rather than spent while the page moves. */}
      <Glow pulse={pulse} delay={320} bleed={-4}>
        {children}
      </Glow>
    </View>
  )
}
